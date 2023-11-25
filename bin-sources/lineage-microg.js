import "zx/globals";
import {load} from "cheerio";

export const label = "LineageOS for microG";

export async function getDevicePayloadUrl(deviceName) {
    const deviceBaseURL = `https://download.lineage.microg.org/${path.normalize(deviceName)}/`;

    const listing = await fetch(deviceBaseURL).then(res => {
        if (res.status === 404) throw new Error("Device does not exist (got 404)");
        if (res.status !== 200) throw new Error(`Unexpected status code (got ${res.status})`);
        return res.text();
    });

    const $$ = load(listing);

    const downloads = $$(".listing > table > tbody > tr.file").map(function () {
        const fileName = $$("td > a[href]", this).attr("href");

        const timeStr = $$("td > time[datetime]", this).attr("datetime");
        const time = new Date(timeStr).getTime();

        return {fileName, time};
    });

    const target = downloads.reduce((max, curr) => {
        if (!curr.fileName.endsWith(`${deviceName}.zip`)) return max;
        if (curr.time <= max.time) return max;
        return curr;
    }, {time: 0});

    if (!target.fileName) throw new Error("Didn't find any downloads");

    return {
        url: `${deviceBaseURL}${target.fileName}`,
        checksumUrl: `${deviceBaseURL}${target.fileName}.sha256sum`,
        updateTime: target.time
    };
}
