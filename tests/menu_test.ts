import { Api, Context } from "../src/deps.deno.ts";
import { Menu, type MenuButton, MenuRange } from "../src/menu.ts";

class TestMenu<C extends Context = Context> extends Menu<C> {
    renderForTest(ctx: C) {
        return this.render(ctx);
    }
}

const ctx = {} as Context;

function assertEquals(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
            `Expected ${JSON.stringify(expected)}, got ${
                JSON.stringify(actual)
            }`,
        );
    }
}

async function payloads<C extends Context>(menu: TestMenu<C>, context: C) {
    const keyboard = await menu.renderForTest(context);
    return keyboard.flat().map((button) => {
        if (!("callback_data" in button)) {
            throw new Error("Not a callback button");
        }
        return button.callback_data.split("/")[3];
    });
}

Deno.test("no default preserves empty payloads", async () => {
    const menu = new TestMenu("test")
        .text("A")
        .append(new MenuRange().text("B"));
    assertEquals(await payloads(menu, ctx), ["", ""]);
});

Deno.test("default applies to text, navigation, and direct callback buttons", async () => {
    const menu = new TestMenu("test", { payload: "default" })
        .text("A")
        .text({ text: "B" })
        .submenu("Next", "next")
        .back("Back")
        .add({ text: "Raw button", middleware: [] });
    assertEquals(await payloads(menu, ctx), Array(5).fill("default"));
});

Deno.test("explicit payloads override defaults, including empty strings", async () => {
    const menu = new TestMenu("test", { payload: "default" })
        .text({ text: "A", payload: "explicit" })
        .text({ text: "B", payload: "" })
        .text({ text: "C", payload: undefined })
        .text({ text: "D", payload: () => "sync" })
        .text({ text: "E", payload: () => Promise.resolve("async") });
    assertEquals(await payloads(menu, ctx), [
        "explicit",
        "",
        "default",
        "sync",
        "async",
    ]);
});

Deno.test("dynamic defaults are evaluated per button at render time", async () => {
    type MyContext = Context & { value: string };
    let calls = 0;
    const menu = new TestMenu<MyContext>("test", {
        payload: (ctx) => {
            calls++;
            return Promise.resolve(ctx.value);
        },
    }).text((ctx) => ctx.value).text("B").text({
        text: "C",
        payload: "override",
    });
    assertEquals(calls, 0);
    assertEquals(await payloads(menu, { value: "first" } as MyContext), [
        "first",
        "first",
        "override",
    ]);
    assertEquals(calls, 2);
    assertEquals(await payloads(menu, { value: "second" } as MyContext), [
        "second",
        "second",
        "override",
    ]);
    assertEquals(calls, 4);
});

Deno.test("sync defaults and empty defaults work", async () => {
    const menu = new TestMenu("test")
        .append(new MenuRange({ payload: () => "sync" }).text("A"))
        .append(new MenuRange({ payload: "" }).text("B"));
    assertEquals(await payloads(menu, ctx), ["sync", ""]);
});

Deno.test("default configuration is captured without mutating input buttons", async () => {
    const options = { payload: "original" };
    const button = { text: "A", middleware: [] };
    const menu = new TestMenu("test", options).add(button).danger();
    options.payload = "changed";
    assertEquals(button, { text: "A", middleware: [] });
    assertEquals(await payloads(menu, ctx), ["original"]);
    const keyboard = await menu.renderForTest(ctx);
    assertEquals(keyboard[0][0].style, "danger");
});

Deno.test("appended ranges and raw ranges retain their own payloads", async () => {
    const raw = [[{ text: "Raw", middleware: [] }]];
    const menu = new TestMenu("test", { payload: "outer" })
        .append(new MenuRange({ payload: "inner" }).text("A"))
        .append(new MenuRange().text("B"))
        .append(raw)
        .addRange(new MenuRange({ payload: "nested" }).text("C"))
        .addRange(new MenuRange().text("D"))
        .addRange(raw)
        .text("Local");
    assertEquals(await payloads(menu, ctx), [
        "inner",
        "",
        "",
        "nested",
        "",
        "",
        "outer",
    ]);
    assertEquals(raw, [[{ text: "Raw", middleware: [] }]]);
});

Deno.test("dynamic ranges do not inherit defaults", async () => {
    const menu = new TestMenu("test", { payload: "outer" })
        .dynamic((_ctx, range) => {
            range.text("Supplied");
        })
        .dynamic(() =>
            new MenuRange({ payload: "inner" }).text("Returned")
                .dynamic((_ctx, range) => {
                    range.text("Nested supplied");
                })
        )
        .text("Local");
    assertEquals(await payloads(menu, ctx), ["", "inner", "", "outer"]);
});

Deno.test("non-callback buttons do not receive a default payload", async () => {
    const menu = new TestMenu("test", { payload: "default" })
        .url("URL", "https://grammy.dev")
        .webApp("App", "https://grammy.dev")
        .text("Callback").primary().icon("123");
    const keyboard = await menu.renderForTest(ctx);
    assertEquals(keyboard[0][0], { text: "URL", url: "https://grammy.dev" });
    assertEquals(keyboard[0][1], {
        text: "App",
        web_app: { url: "https://grammy.dev" },
    });
    assertEquals(keyboard[0][2].style, "primary");
    assertEquals(keyboard[0][2].icon_custom_emoji_id, "123");
});

Deno.test("registered menus keep independent defaults", async () => {
    const parent = new TestMenu("parent", { payload: "parent" }).submenu(
        "Next",
        "child",
    );
    const child = new TestMenu("child").back("Back");
    parent.register(child);
    assertEquals(await payloads(parent, ctx), ["parent"]);
    assertEquals(await payloads(child, ctx), [""]);
});

Deno.test("default payloads retain slash validation", async () => {
    const menu = new TestMenu("test", { payload: "not/allowed" }).text("A");
    try {
        await menu.renderForTest(ctx);
    } catch (error) {
        if (
            error instanceof Error &&
            error.message.includes("Payload must not contain")
        ) return;
        throw error;
    }
    throw new Error("Expected slash validation to reject the payload");
});

Deno.test("direct explicit callback payload does not invoke the default", async () => {
    const button: MenuButton<Context> = {
        text: "A",
        middleware: [],
        payload: "",
    };
    const menu = new TestMenu("test", {
        payload: () => {
            throw new Error("Default should not run");
        },
    }).add(button);
    assertEquals(await payloads(menu, ctx), [""]);
});

Deno.test("callback dispatch reads the sent payload without reevaluating its default", async () => {
    let calls = 0;
    const matches: unknown[] = [];
    const menu = new TestMenu("test", {
        autoAnswer: false,
        payload: () => `sent-${++calls}`,
    }).text("Default", (ctx) => {
        matches.push(ctx.match);
    }).text({ text: "Empty", payload: "" }, (ctx) => {
        matches.push(ctx.match);
    });
    const keyboard = await menu.renderForTest(ctx);
    const me = {
        id: 42,
        is_bot: true as const,
        first_name: "Test",
        username: "test_bot",
        can_join_groups: false,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
        has_topics_enabled: false,
        allows_users_to_create_topics: false,
        can_manage_bots: false,
        supports_join_request_queries: false,
    };
    for (const button of keyboard[0]) {
        if (!("callback_data" in button)) {
            throw new Error("Not a callback button");
        }
        const callbackContext = new Context(
            {
                update_id: 1,
                callback_query: {
                    id: "query",
                    from: { id: 1, is_bot: false, first_name: "User" },
                    chat_instance: "chat",
                    data: button.callback_data,
                },
            },
            new Api("42:test"),
            me,
        );
        await menu.middleware()(callbackContext, () => Promise.resolve());
    }
    assertEquals(matches.length, 2);
    assertEquals(matches[0], "sent-1");
    assertEquals(matches[1], undefined);
    assertEquals(calls, 1);
});
