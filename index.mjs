#!/usr/bin/env zx

import "zx/globals";
import {echo} from "zx/experimental";
import cheerio from "cheerio";
import {createHash} from "crypto";
import cloneable from "cloneable-readable";
import {PassThrough} from "stream";
import StreamZip from "node-stream-zip";

const DL_URL = process.env.DL_URL ?? "https://download.lineage.microg.org";

async function check(message) {
    while (true) {
        const result = await question(`${message} (y/N) `)
            .then(result => result.toLowerCase());

        if (result === "y") return true;
        if (!result || result === "n") return false;

        await echo`Invalid response "${result}". Must be either Y or N.`;
    }
}

fs.mkdirSync("dl", {recursive: true});
fs.mkdirSync("wd", {recursive: true});

const device = await question("What is the code of your device (case sensitive)? ");

if (/[^a-z0-9_]/i.test(device)) throw new Error("Invalid device name");

const listing = await fetch(`${DL_URL}/${path.normalize(device)}/`).then(res => {
    if (res.status === 404) throw new Error("Device does not exist (got 404)");
    if (res.status !== 200) throw new Error(`Invalid status code (got ${res.status})`);
    return res.text();
});

const $$ = cheerio.load(listing);

const downloads = $$(".listing > table > tbody > tr.file").map(function () {
    const url = $$("td > a[href]", this).attr("href");

    const timeStr = $$("td > time[datetime]", this).attr("datetime");
    const time = new Date(timeStr).getTime();

    return {fname: url, time};
}).toArray();

const target = downloads.reduce((max, curr) => curr.fname.endsWith(`${device}.zip`) && curr.time > max.time ? curr : max, {time: 0});

if (!target.fname) throw new Error("Didn't find any downloads");

await echo`Downloading checksum`;
const expectedHash = await fetch(`${DL_URL}/${path.normalize(device)}/${target.fname + ".sha256sum"}`).then(res => res.text()).then(txt => txt.split(" ")[0]);
await echo`expecting checksum to be ${expectedHash}`;

const checksumHasher = createHash("sha256");
let actualHash;

if (fs.existsSync("dl/" + target.fname)) {
    await echo`Skipping download as ${target.fname} already exists`;

    const file = fs.createReadStream("dl/" + target.fname);
    file.pipe(checksumHasher);

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
} else {
    await echo`Downloading the latest version, updated ${new Date(target.time).toLocaleDateString()}`;

    await echo`downloading file`;
    const fileDl = $`wget ${`${DL_URL}/${path.normalize(device)}/${target.fname}`} -q --show-progress --progress=bar:force -O -`;

    const fileDlPt = new PassThrough();
    fileDl.pipe(fileDlPt);

    const fileDlStream = cloneable(fileDlPt);

    const outputFile = fs.createWriteStream("dl/" + target.fname);
    fileDlStream.clone().pipe(outputFile);
    fileDlStream.pipe(checksumHasher);

    fileDl.stderr.pipe(process.stdout);

    await fileDl;
}

actualHash = checksumHasher.digest("hex");

if (expectedHash === actualHash) {
    await echo`The checksum matches the expected value`;
} else {
    throw new Error(`The checksum does not match the expected (expected ${expectedHash}, actual ${actualHash})`);
}

const zip = new StreamZip.async({
    file: "dl/" + target.fname
});

const simpleBootImg = await zip.entry("boot.img");
if (simpleBootImg) {
    await echo`Found boot.img file`;
    await zip.extract(simpleBootImg, "wd/boot.img");
    process.exit(0);
}

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

fs.renameSync("wd/boot.img", "./boot.img");
fs.rmSync("wd", {recursive: true, force: true});

await echo`If the above command completed successfully, you should now have a boot.img file`;
