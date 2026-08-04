// Playwright (Python) code generator for recorded sessions.
//
// DOM steps become locator-based actions; visual steps (canvas/iframe) become
// image-anchored actions backed by an OpenCV helper library (thoth_visual.py).
// generatePlaywrightProject returns the script, the helper module, and the set
// of baseline PNG assets the visual steps reference.

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

export interface CodegenAsset {
    relPath: string;   // e.g. "baselines/step_03.png"
    base64: string;
}

export interface CodegenProject {
    script: string;
    helper: string;
    assets: CodegenAsset[];
}

// Python string literal. JSON.stringify yields a valid double-quoted literal for
// our content (escapes ", \, control chars); Python accepts the same escapes.
function py(value: string): string {
    return JSON.stringify(value ?? '');
}

function pad(n: number): string {
    return String(n).padStart(3, '0');
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

interface StepOutput {
    lines: string[];
    asset?: CodegenAsset;
}

function stepFor(event: SerializedEvent, index: number): StepOutput {
    let data: any = {};
    try {
        data = JSON.parse(event.data);
    } catch {
        data = {};
    }

    switch (event.type) {
        case 'navigation':
            if (data.navType === 'spa') {
                return { lines: [`page.wait_for_url(${py(data.url)})  # SPA navigation`] };
            }
            return { lines: [`page.goto(${py(data.url)})`] };

        case 'click':
            if (isVisual(data)) {
                const rel = `baselines/step_${pad(index)}_click.png`;
                const template = data.minTrimmedClickViewBase64 || data.maxTrimmedClickViewBase64;
                if (!template) {
                    return { lines: [`page.mouse.click(${data.x}, ${data.y})  # visual target (no template captured)`] };
                }
                return {
                    lines: [`visual_click(page, os.path.join(BASE_DIR, ${py(rel)}), threshold=VISUAL_MATCH_THRESHOLD)`],
                    asset: { relPath: rel, base64: template }
                };
            }
            return { lines: [`${locatorExpr(data.selectors)}.click()`] };

        case 'input': {
            if (isVisual(data)) {
                return { lines: [`page.keyboard.type(${py(data.value)})  # visual field`] };
            }
            const loc = locatorExpr(data.selectors);
            if (data.controlType === 'select') {
                return { lines: [`${loc}.select_option(${py(data.value)})`] };
            }
            if (data.controlType === 'checkbox' || data.controlType === 'radio') {
                return { lines: [`${loc}.set_checked(${data.checked ? 'True' : 'False'})`] };
            }
            return { lines: [`${loc}.fill(${py(data.value)})`] };
        }

        case 'keypress': {
            const keys: string = data.keys ?? '';
            const action = /^\[(.+?)(?: ×(\d+))?\]$/.exec(keys);
            if (action) {
                const name = action[1];
                const count = action[2] ? parseInt(action[2], 10) : 1;
                if (count > 1) {
                    return { lines: [`for _ in range(${count}): page.keyboard.press(${py(name)})`] };
                }
                return { lines: [`page.keyboard.press(${py(name)})`] };
            }
            return { lines: [`page.keyboard.type(${py(keys)})`] };
        }

        case 'scroll':
            return { lines: [`page.evaluate(${py(`window.scrollTo(${data.x || 0}, ${data.y || 0})`)})`] };

        case 'area-select': {
            const rel = `baselines/step_${pad(index)}_region.png`;
            const clip = `{"x": ${data.left}, "y": ${data.top}, "width": ${data.right - data.left}, "height": ${data.bottom - data.top}}`;
            if (!data.areaSelectViewBase64) {
                return { lines: [`# visual assertion for region ${clip} (no baseline captured)`] };
            }
            return {
                lines: [`visual_assert(page, ${clip}, os.path.join(BASE_DIR, ${py(rel)}), threshold=VISUAL_STATE_THRESHOLD)`],
                asset: { relPath: rel, base64: data.areaSelectViewBase64 }
            };
        }

        default:
            return { lines: [`# unsupported event type: ${event.type}`] };
    }
}

// The OpenCV-backed runtime helper the generated tests import.
export const THOTH_VISUAL_HELPER = `"""Thoth visual helpers — image-anchored interaction for canvas/iframe content.

Requires: pip install opencv-python numpy playwright
"""
import time

import cv2
import numpy as np
from playwright.sync_api import Page


def _screenshot_cv(page: Page, clip=None):
    png = page.screenshot(clip=clip) if clip else page.screenshot()
    arr = np.frombuffer(png, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _load_cv(path: str):
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError("baseline image not found: " + path)
    return img


def locate(page: Page, template_path: str, threshold: float = 0.8, timeout: float = 10.0):
    """Template-match a recorded crop in the live page. Returns the match center in
    CSS pixels, retrying until found or timeout (so it also acts as a wait)."""
    template = _load_cv(template_path)
    dpr = page.evaluate("window.devicePixelRatio") or 1
    deadline = time.time() + timeout
    best = 0.0
    while time.time() < deadline:
        screen = _screenshot_cv(page)
        res = cv2.matchTemplate(screen, template, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(res)
        if max_val >= threshold:
            th, tw = template.shape[:2]
            cx = (max_loc[0] + tw / 2) / dpr
            cy = (max_loc[1] + th / 2) / dpr
            return cx, cy
        best = max(best, max_val)
        page.wait_for_timeout(250)
    raise AssertionError(
        "visual target not found (best match %.3f < %.3f): %s" % (best, threshold, template_path)
    )


def visual_click(page: Page, template_path: str, threshold: float = 0.8, timeout: float = 10.0):
    x, y = locate(page, template_path, threshold, timeout)
    page.mouse.click(x, y)


def _region_score(page: Page, clip: dict, baseline):
    region = _screenshot_cv(page, clip=clip)
    region = cv2.resize(region, (baseline.shape[1], baseline.shape[0]))
    res = cv2.matchTemplate(region, baseline, cv2.TM_CCOEFF_NORMED)
    return float(res.max())


def wait_for_visual_state(page: Page, clip: dict, baseline_path: str, threshold: float = 0.95, timeout: float = 15.0):
    """Poll a region until it visually matches the baseline, then proceed."""
    baseline = _load_cv(baseline_path)
    deadline = time.time() + timeout
    score = 0.0
    while time.time() < deadline:
        score = _region_score(page, clip, baseline)
        if score >= threshold:
            return
        page.wait_for_timeout(300)
    raise AssertionError(
        "visual state not reached (score %.3f < %.3f): %s" % (score, threshold, baseline_path)
    )


def visual_assert(page: Page, clip: dict, baseline_path: str, threshold: float = 0.95):
    baseline = _load_cv(baseline_path)
    score = _region_score(page, clip, baseline)
    assert score >= threshold, (
        "region does not match baseline (score %.3f < %.3f): %s" % (score, threshold, baseline_path)
    )
`;

export function generatePlaywrightProject(events: SerializedEvent[], testName: string = 'recorded_test'): CodegenProject {
    const body: string[] = [];
    const assets: CodegenAsset[] = [];

    // Derive a fill from order of operations: a click on a DOM (non-visual) field
    // immediately followed by a typed text run IS a fill, so collapse the two into a
    // single `locator.fill(text)`. Visual (canvas/iframe) clicks and action-key runs
    // (e.g. [Enter]) are left as-is.
    const consumed = new Set<number>();
    const parseData = (e: SerializedEvent): any => { try { return JSON.parse(e.data); } catch { return {}; } };

    events.forEach((event, index) => {
        if (consumed.has(index)) return;

        let step: StepOutput | null = null;
        if (event.type === 'click') {
            const clickData = parseData(event);
            const next = events[index + 1];
            if (!isVisual(clickData) && next && next.type === 'keypress') {
                const keys: string = parseData(next).keys ?? '';
                const isActionRun = /^\[.+\]$/.test(keys);
                if (!isActionRun && keys.length > 0) {
                    step = { lines: [`${locatorExpr(clickData.selectors)}.fill(${py(keys)})`] };
                    consumed.add(index + 1);
                }
            }
        }
        if (!step) step = stepFor(event, index);

        if (step.asset) {
            assets.push(step.asset);
        }
        for (const line of step.lines) {
            body.push(`    ${line}`);
        }
    });
    if (body.length === 0) {
        body.push('    pass  # no steps recorded');
    }

    const safeName = testName.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'recorded_test';

    const script = `import os

from playwright.sync_api import sync_playwright, expect
from thoth_visual import visual_click, wait_for_visual_state, visual_assert

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Visual match tolerances (0..1). Tune per project; higher = stricter.
VISUAL_MATCH_THRESHOLD = 0.8
VISUAL_STATE_THRESHOLD = 0.95


def ${safeName}(page):
${body.join('\n')}


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()
        ${safeName}(page)
        browser.close()
`;

    return { script, helper: THOTH_VISUAL_HELPER, assets };
}

// Backwards-compatible: the script text only (used for the review-UI preview).
export function generatePlaywrightScript(events: SerializedEvent[], testName: string = 'recorded_test'): string {
    return generatePlaywrightProject(events, testName).script;
}
