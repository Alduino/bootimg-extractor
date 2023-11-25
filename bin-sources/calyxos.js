import {load} from "cheerio";
import StreamZip from "node-stream-zip";
import {echo} from "zx/experimental";
import {check} from "../utils/check.js";

export const label = "CalyxOS";

export async function getDevicePayloadUrl(deviceName) {
    const installDocSource = await fetch(`https://calyxos.org/install/devices/${path.normalize(deviceName)}/windows/`)
        .then(res => {
            if (res.status === 404) throw new Error("Device does not exist (got 404)");
            if (res.status !== 200) throw new Error(`Unexpected status code (got ${res.status})`);
            return res.text();
        });

    const $$ = load(installDocSource);

    const downloadUrl = $$($$("a.btn").toArray().find(el => {
        const href = $$(el).attr("href");
        return /^https:\/\/release\.calyxinstitute\.org\/[^-]+-factory-[^-]+\.zip$/.test(href);
    })).attr("href");

    const signatureUrl = downloadUrl + ".sha256sum";

    return {
        url: downloadUrl,
        checksumUrl: signatureUrl,
        updateTime: new Date(0) // No way to get this from the website
    };
}

export async function extractFirmware(fileName) {
    const zip = new StreamZip.async({
        file: fileName
    });

    const entries = await zip.entries();
    const entry = Object.values(entries).find(entry => /image-.+?\.zip$/.test(entry.name));

    if (!entry) {
        await echo`No firmware file found in ${path.basename(fileName)}`;
        process.exit(1);
    }

    const firmwareFileName = `wd/${path.basename(entry.name)}`;
    echo`Extracting firmware file ${path.basename(entry.name)}`;

    await zip.extract(entry, firmwareFileName);
    await zip.close();

    return firmwareFileName;
}
