#!/usr/bin/env zx

import "zx/globals";
import {echo} from "zx/experimental";
import {createHash} from "crypto";
import cloneable from "cloneable-readable";
import {PassThrough} from "stream";
import StreamZip from "node-stream-zip";
import {binSourcesRegistry} from "./bin-sources/index.js";
import {check} from "./utils/check.js";

const DL_URL = process.env.DL_URL ?? "https://download.lineage.microg.org";

fs.mkdirSync("dl", {recursive: true});
fs.mkdirSync("wd", {recursive: true});

const device = await question("What is the code of your device (case sensitive)? ");

if (/[^a-z0-9_]/i.test(device)) throw new Error("Invalid device name");

const binarySource = await (async () => {
    while (true) {
        const questionLines = [
            "What ROM are you running?",
            ...binSourcesRegistry.map((source, i) => `${i + 1}. ${source.label}`),
            "ROM number: "
        ];

        const result = await question(questionLines.join("\n") + "\n");
        const index = parseInt(result, 10) - 1;

        if (Number.isNaN(index) || index < 0 || index >= binSourcesRegistry.length) {
            await echo`Invalid response "${result}". Must be a number between 1 and ${binSourcesRegistry.length}`;
            continue;
        }

        return binSourcesRegistry[index];
    }
})();

const target = await binarySource.getDevicePayloadUrl(device);
const fileName = new URL(target.url).pathname.split("/").pop();

await echo`Downloading checksum`;
const expectedHash = await fetch(target.checksumUrl).then(res => res.text()).then(txt => txt.split(" ")[0]);
await echo`(Expecting checksum to be ${expectedHash})`;

let requiresDownload = true;

if (fs.existsSync("dl/" + fileName)) {
    await echo`Skipping download as ${fileName} already exists`;

    const file = fs.createReadStream("dl/" + fileName);
    const hasher = file.pipe(createHasher());

    await new Promise((yay, nay) => {
        function resolve() {
            yay();

            file.off("end", resolve);
            file.off("error", reject);
        }

        function reject(err) {
            nay(err);

            file.off("end", resolve);
            file.off("error", reject);
        }

        file.on("end", resolve);
        file.on("error", reject);
    });

    if (await checkHash(hasher)) {
        requiresDownload = false;
    }
}

if (requiresDownload) {
    await echo`Downloading the latest version, updated ${new Date(target.updateTime).toLocaleDateString()}`;

    await echo`downloading file`;
    const fileDl = $`wget ${target.url} -q --show-progress --progress=bar:force -O -`;

    const fileDlPt = new PassThrough();
    fileDl.pipe(fileDlPt);

    const fileDlStream = cloneable(fileDlPt);

    const outputFile = fs.createWriteStream("dl/" + fileName);
    fileDlStream.clone().pipe(outputFile);
    const hasher = fileDlStream.pipe(createHasher());

    fileDl.stderr.pipe(process.stdout);

    await fileDl;

    if (!await checkHash(hasher)) {
        process.exit(1);
    }
}

function createHasher() {
    return createHash("sha256");
}

async function checkHash(checksumHasher) {
    const actualHash = checksumHasher.digest("hex");

    if (expectedHash === actualHash) {
        await echo`The checksum matches the expected value`;
        return true;
    } else {
        await echo`The checksum does not match the expected (expected ${expectedHash}, actual ${actualHash})`;
        return false;
    }
}

const firmwareFileName = await binarySource.extractFirmware?.(`dl/${fileName}`) ?? `dl/${fileName}`;

const zip = new StreamZip.async({
    file: firmwareFileName
});

const simpleBootImg = await zip.entry("boot.img");
if (simpleBootImg) {
    await echo`Found boot.img file`;
    await zip.extract(simpleBootImg, "wd/boot.img");
} else {
    const payloadBin = await zip.entry("payload.bin");
    if (!payloadBin) throw new Error("Missing both boot.img and payload.bin. This firmware is not supported.");

    await echo`Found payload.bin file, will extract boot.img from it`;

    await zip.extract(payloadBin, "wd/payload.bin");

    await $`docker run --rm -v ${path.resolve("wd")}:/data/ -it vm03/payload_dumper /data/payload.bin --out /data --images boot`;

    if (!fs.existsSync("wd/boot.img")) {
        await echo`Missing boot.img file. The extraction was probably unsuccessful`;
        process.exit(1);
    }

    if (fs.existsSync("boot.img")) {
        if (!await check("A boot.img file already exists. Are you sure you want to overwrite it?")) {
            await echo`Please rename the existing boot.img file so that you can extract the new one.`;
            fs.rmSync("wd", {recursive: true, force: true});
            process.exit(1);
        }
    }
}

fs.renameSync("wd/boot.img", "./boot.img");
fs.rmSync("wd", {recursive: true, force: true});

await echo`Do you want to perform Magisk patching?`;
if (await check("Please note this has only been verified to work on my PL2 and oriole devices. If you have a different device, make sure that the steps are correct.")) {
    if (!await check("If a file exists at /sdcard/Download/magisk/boot-unpatched.img, it will be overwritten. Is this OK?")) {
        await echo`Check that no file exists at that path and try again.`;
        process.exit(1);
    }

    await $`adb push boot.img /sdcard/Download/magisk/boot-unpatched.img`;
    await $`adb shell am start -n com.topjohnwu.magisk/com.topjohnwu.magisk.ui.MainActivity`;

    await echo`Click "install" beside "Magisk" at the top, then click "Select and Patch a File". Navigate to the magisk folder in your downloads and select "boot-unpatched.img", then click "Let's go" on the right.`;
    await echo`(You might need to unlock your phone if it isn't already)`;
    await question("Press enter once Magisk has finished patching the file.");

    const {stdout: patchedFilesJoined} = await $`adb shell ls /sdcard/Download -t | grep magisk_patched --include "*.img" --color=never`;
    const patchedFile = patchedFilesJoined.split("\n")[0];

    if (!patchedFile) {
        await echo`Missing patched output. Are you sure Magisk has completed?`;
        process.exit(1);
    }

    await echo`Assuming "${patchedFile}" is the output from the magisk patching. If it isn't, press "n" when asked to reboot.`;

    if (fs.existsSync("boot-patched.img")) {
        if (!await check("A boot-patched.img file already exists. Are you sure you want to overwrite it?")) {
            await echo`Please rename the existing boot-patched.img file so that you can extract the new one.`;
            process.exit(1);
        }
    }

    await $`adb pull /sdcard/Download/${patchedFile} boot-patched.img`;

    await check("We need to reboot to complete the installation. Press \"y\" when you are ready to reboot, if the patched file's name was the same as Magisk logged.");

    await $`adb reboot fastboot`;
    await question("Press enter once your phone has booted into fastboot.");

    await $`fastboot flash boot boot-patched.img`;
    await $`fastboot reboot`;

    await echo`Once your phone reboots, Magisk should be up and running again.`;
}
