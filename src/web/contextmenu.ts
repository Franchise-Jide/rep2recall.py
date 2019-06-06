import "jquery-contextmenu";
import $ from "jquery";
import "jquery-contextmenu/dist/jquery.contextMenu.min.css";

$(() => {
    // @ts-ignore
    $.contextMenu({
        selector: ".tree-text",
        callback(key: string, opt: any) {
            opt.$trigger.data(key)();
        },
        items: {
            due: {
                name: "Review due"
            },
            leech: {
                name: "Review leech"
            },
            new: {
                name: "Review new"
            },
            dueAndNew: {
                name: "Review due and new"
            },
            separator1: "-----",
            all: {
                name: "Review all"
            },
            separator2: "-----",
            export: {
                name: "Export deck"
            },
            delete: {
                name: "Delete deck"
            }
        }
    });
});
