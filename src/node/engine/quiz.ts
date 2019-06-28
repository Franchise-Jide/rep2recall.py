import moment from "moment";

export const srsMap = [
    moment.duration(4, "hour"),
    moment.duration(8, "hour"),
    moment.duration(1, "day"),
    moment.duration(3, "day"),
    moment.duration(1, "week"),
    moment.duration(2, "week"),
    moment.duration(4, "week"),
    moment.duration(16, "week")
];

export function getNextReview(srsLevel: number): string {
    let toAdd = srsMap[srsLevel];
    
    if (!toAdd) {
        toAdd = moment.duration(10, "minute");
    }

    return moment().add(toAdd).toISOString();
}

export function repeatReview(): string {
    return moment().add(10, "minute").toISOString();
}