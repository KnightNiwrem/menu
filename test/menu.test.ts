import { Bot, type Context } from "@grammyjs/grammy";
import type { Update, UserFromGetMe } from "@grammyjs/grammy/types";
import { Menu, type MenuControlPanel, type MenuFlavor } from "../src/mod.ts";

function assertEquals(actual: unknown, expected: unknown): void {
    if (!Object.is(actual, expected)) {
        throw new Error(`Expected ${expected}, received ${actual}`);
    }
}

function assertInstanceOf(value: unknown, constructor: typeof Menu): void {
    if (!(value instanceof constructor)) {
        throw new Error(`Expected an instance of ${constructor.name}`);
    }
}

const me = {
    id: 1,
    is_bot: true,
    first_name: "Test Bot",
    username: "test_bot",
} as UserFromGetMe;

const message = {
    message_id: 1,
    date: 0,
    chat: { id: 1, type: "private", first_name: "Test" },
    from: { id: 2, is_bot: false, first_name: "Test" },
    text: "show menu",
} as const;

type CustomContext = Context & { custom: string };
type FlavoredContext = MenuFlavor<CustomContext>;

Deno.test("transforms custom contexts for menu handlers", () => {
    const useFlavor = (ctx: FlavoredContext) => {
        const custom: string = ctx.custom;
        const panel: MenuControlPanel = ctx.menu;
        void custom;
        void panel;
    };
    const menu = new Menu<CustomContext>("typed").text(
        { text: (ctx) => ctx.custom, payload: "payload" },
        (ctx) => {
            const payload: string = ctx.payload;
            const panel: MenuControlPanel = ctx.menu;
            void payload;
            void panel;
        },
    );

    void useFlavor;
    assertInstanceOf(menu, Menu);
});

Deno.test("renders and handles menus through grammY 2.0 API transforms", async () => {
    let receivedPayload: string | undefined;
    const menu = new Menu("root", {
        autoAnswer: false,
        onMenuOutdated: false,
    }).text(
        { text: "Press", payload: "details" },
        (ctx) => {
            receivedPayload = ctx.payload;
            ctx.menu.close();
        },
    );
    const bot = new Bot("test-token", {
        me,
        client: { canUseWebhookReply: () => true },
    });
    bot.use(menu);
    bot.use((ctx) => ctx.sendMessage("Menu", { reply_markup: menu }));

    const sent: string[] = [];
    await bot.handleUpdate(
        { update_id: 1, message } as Update,
        {
            send: (payload) => {
                sent.push(payload);
            },
        },
    );

    const outgoing = JSON.parse(sent[0]);
    const callbackData = outgoing.reply_markup.inline_keyboard[0][0]
        .callback_data;
    assertEquals(outgoing.method, "sendMessage");
    assertEquals(outgoing.reply_markup.inline_keyboard[0][0].text, "Press");

    await bot.handleUpdate(
        {
            update_id: 2,
            callback_query: {
                id: "query",
                from: message.from,
                chat_instance: "instance",
                data: callbackData,
                message,
            },
        } as Update,
        {
            send: (payload) => {
                sent.push(payload);
            },
        },
    );

    assertEquals(receivedPayload, "details");
    assertEquals(sent.length, 2);
    assertEquals(JSON.parse(sent[1]).method, "editMessageReplyMarkup");
});
