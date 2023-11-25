import {echo} from "zx/experimental";

export async function check(message) {
    while (true) {
        const result = await question(`${message} (y/N) `)
            .then(result => result.toLowerCase());

        if (result === "y") return true;
        if (!result || result === "n") return false;

        await echo`Invalid response "${result}". Must be either Y or N.`;
    }
}
