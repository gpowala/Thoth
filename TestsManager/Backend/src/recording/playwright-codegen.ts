// Playwright (Python) code generator for recorded sessions.
//
// Operates on the serialized event stream (the same {type, data} shape the
// frontend consumes). DOM steps become locator-based actions; visual steps
// (canvas/iframe) become coordinate placeholders that Phase 2 will upgrade to
// image-anchored actions. Kept intentionally dependency-free and string-based.

interface SerializedEvent {
    id: string;
    timestamp: Date | string;
    type: string;
    data: string; // JSON
}

interface Selectors {
    testId?: string | null;
    id?: string | null;
    css?: string | null;
    xpath?: string | null;
}

// Python string literal. JSON.stringify yields a valid double-quoted literal for
// our content (escapes ", \, control chars); Python accepts the same escapes.
function py(value: string): string {
    return JSON.stringify(value ?? '');
}

// Build the `page.<locator>(...)` expression from the captured selector candidates,
// preferring the most stable: test-id > id > css > xpath.
function locatorExpr(selectors?: Selectors): string {
    if (selectors) {
        if (selectors.testId) {
            const idx = selectors.testId.indexOf('=');
            const attr = idx >= 0 ? selectors.testId.slice(0, idx) : selectors.testId;
            const value = idx >= 0 ? selectors.testId.slice(idx + 1) : '';
            if (attr === 'data-testid') {
                return `page.get_by_test_id(${py(value)})`;
            }
            return `page.locator(${py(`[${attr}="${value}"]`)})`;
        }
        if (selectors.id) return `page.locator(${py('#' + selectors.id)})`;
        if (selectors.css) return `page.locator(${py(selectors.css)})`;
        if (selectors.xpath) return `page.locator(${py('xpath=' + selectors.xpath)})`;
    }
    return 'page.locator("body")';
}

function isVisual(data: any): boolean {
    return data?.targetKind === 'visual';
}

// One or more Python statements (indented later) for a single event.
function lineFor(event: SerializedEvent): string[] {
    let data: any = {};
    try {
        data = JSON.parse(event.data);
    } catch {
        data = {};
    }

    switch (event.type) {
        case 'navigation':
            if (data.navType === 'spa') {
                return [`page.wait_for_url(${py(data.url)})  # SPA navigation`];
            }
            return [`page.goto(${py(data.url)})`];

        case 'click':
            if (isVisual(data)) {
                return [`page.mouse.click(${data.x}, ${data.y})  # visual target (Phase 2: image-anchored)`];
            }
            return [`${locatorExpr(data.selectors)}.click()`];

        case 'input': {
            if (isVisual(data)) {
                return [`page.keyboard.type(${py(data.value)})  # visual field`];
            }
            const loc = locatorExpr(data.selectors);
            if (data.controlType === 'select') {
                return [`${loc}.select_option(${py(data.value)})`];
            }
            if (data.controlType === 'checkbox' || data.controlType === 'radio') {
                return [`${loc}.set_checked(${data.checked ? 'True' : 'False'})`];
            }
            return [`${loc}.fill(${py(data.value)})`];
        }

        case 'keypress': {
            const keys: string = data.keys ?? '';
            const action = /^\[(.+)\]$/.exec(keys);
            if (action) {
                return [`page.keyboard.press(${py(action[1])})`];
            }
            return [`page.keyboard.type(${py(keys)})`];
        }

        case 'scroll':
            return [`page.evaluate(${py(`window.scrollTo(${data.x || 0}, ${data.y || 0})`)})`];

        case 'area-select':
            return [
                `# TODO (Phase 2): visual assertion for region ` +
                `(${data.left}, ${data.top})-(${data.right}, ${data.bottom})`,
                `# expect(page).to_have_screenshot("region.png")`
            ];

        default:
            return [`# unsupported event type: ${event.type}`];
    }
}

export function generatePlaywrightScript(events: SerializedEvent[], testName: string = 'recorded_test'): string {
    const body: string[] = [];
    for (const event of events) {
        for (const line of lineFor(event)) {
            body.push(`        ${line}`);
        }
    }
    if (body.length === 0) {
        body.push('        pass  # no steps recorded');
    }

    const safeName = testName.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'recorded_test';

    return `from playwright.sync_api import sync_playwright, expect


def ${safeName}(page):
${body.join('\n')}


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()
        ${safeName}(page)
        browser.close()
`;
}
