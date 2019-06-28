import crypto from 'crypto';
import { IDataSocket } from './engine/db';

export function generateSecret(): Promise<string> {
    return new Promise((resolve, reject) => {
        crypto.randomBytes(48, (err, b) => {
            if (err) {
                return reject(err);
            }
            resolve(b.toString("base64"));
        });
    })
}

export function escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');  // $& means the whole matched string
}

export function ankiMustache(s: string, data: IDataSocket[] = [], front: string = ""): string {
    s = s.replace(/{{FrontSide}}/g, (front || "").replace(/@[^\n]+\n/g, ""));
    for (const d of data) {
        s = s.replace(new RegExp(`{{(\\S+:)?${escapeRegExp(d.key)}}}`), d.value);
    }

    const keys = data.map((d) => d.key);

    s = s.replace(/{{#(\S+)}}(.*){{\1}}/gs, (m, p1, p2) => {
        if (keys.includes(p1)) {
            return p2;
        } else {
            return "";
        }
    });

    s = s.replace(/{{[^}]+}}/g, "");

    return s;
}