import path from "path";
// @ts-ignore
import { AppDirs } from "appdirs";
import fs from "fs";
import dotenv from "dotenv";
import Db from "./engine/db";
import http from "http";
dotenv.config();

interface IConfig {
    PORT: string;
    COLLECTION: string;
    DB: Db;
    DIR: string;
    TMP_FOLDER: string;
    MEDIA_FOLDER: string;
    IO?: SocketIO.Server;
    SERVER?: http.Server;
}

export function resourcePath(relativePath: string): string {
    const basePath = process.env.ROOT_PATH || path.join(__dirname, "../..");
    return path.resolve(basePath, relativePath);
}

export const g: IConfig = (() => {
    const COLLECTION = process.env.COLLECTION || path.join(new AppDirs("rep2recall-sqlite").userDataDir(), "user.db");
    const DIR = path.dirname(COLLECTION);

    const config: IConfig = {
        PORT: process.env.PORT || "34972",
        COLLECTION,
        DB: new Db(COLLECTION),
        DIR,
        TMP_FOLDER: path.join(DIR, "tmp"),
        MEDIA_FOLDER: path.join(DIR, "media")
    };
    
    if (!fs.existsSync(DIR)) {
        fs.mkdirSync(DIR);
    }
    
    if (!fs.existsSync(config.TMP_FOLDER)) {
        fs.mkdirSync(config.TMP_FOLDER);
    }
    
    if (!fs.existsSync(config.MEDIA_FOLDER)) {
        fs.mkdirSync(config.MEDIA_FOLDER);
    }

    return config;
})();

async function exitHandler() {
    await g.DB.close();
    g.SERVER!.close()

    try {
        if (fs.existsSync(g.TMP_FOLDER)) {
            fs.unlinkSync(g.TMP_FOLDER);
        }
    } catch (e) {}
}

process.on("exit", exitHandler);
process.on("SIGINT", exitHandler);
process.on("uncaughtException", exitHandler);
