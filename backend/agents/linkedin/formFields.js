'use strict';

// ---------------------------------------------------------------------------
// Easy Apply form filling — one handler per field type.
// Each handler returns true when it put a value in the field.
// ---------------------------------------------------------------------------
const { getAnswer } = require('../../utils/questionAnswerer');
const cfg = require('./config');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

const GROUP_SELECTOR =
    '.jobs-easy-apply-form-section__grouping, ' +
    '.fb-dash-form-element, ' +
    '.jobs-easy-apply-form-element__fields, ' +
    '.jobs-easy-apply-form-element, ' +
    'fieldset.fb-form-element, ' +
    '.artdeco-form-item, ' +
    '.artdeco-text-input--container';

const CUSTOM_DROPDOWN_SELECTOR =
    'button[aria-haspopup="listbox"], ' +
    'button[aria-expanded="false"][aria-haspopup], ' +
    '[role="combobox"]:not(input):not(textarea), ' +
    '.artdeco-dropdown__trigger, ' +
    '.fb-form-element-label + div button, ' +
    'button[data-test-text-entity-list-form-select], ' +
    'button[data-test-single-typeahead-entity-form-component]';

const TEXT_INPUT_SELECTOR =
    'input[type="text"], input[type="number"], input[type="tel"], ' +
    'input[type="email"], textarea, .fb-single-line-text__input';

const TYPEAHEAD_SELECTORS = [
    '[role="option"]',
    '[role="listbox"] li',
    '.basic-typeahead__selectable',
    '.typeahead-result',
    '.search-typeahead-v2__hit',
    'div[data-test-typeahead-item]',
    'ul.fb-autocomplete__suggestions li',
    'li[role="option"]',
    '.ui-autocomplete li',
    '.ui-menu-item',
    '.ui-menu-item-wrapper',
    '.select2-results__option',
    '.select2-result',
    '[class*="select2-results"]',
    '[class*="typeahead"] li',
    '[class*="autocomplete"] li',
    '[class*="suggestions"] li',
];

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

// ---------------------------------------------------------------------------
// Low-level input helpers
// ---------------------------------------------------------------------------
const clearInput = async (page, handle) => {
    await handle.click({ clickCount: 3 });
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Delete');
};

// Human-ish typing; long answers (cover letters) are typed fast like a paste
const typeHuman = (handle, value) => {
    const text = String(value);
    const delay = text.length > 150 ? 0 : randInt(cfg.typeDelayMinMs, cfg.typeDelayMaxMs);
    return handle.type(text, { delay });
};

// Click → clear → type → verify, retry once ("hidden zero" fix)
const typeIntoInput = async (page, elementHandle, value) => {
    await clearInput(page, elementHandle);
    await typeHuman(elementHandle, value);
    const actual = await page.evaluate(el => el.value, elementHandle);
    if (actual !== String(value)) {
        await clearInput(page, elementHandle);
        await typeHuman(elementHandle, value);
    }
};

// Label text for a radio/checkbox input
const getOptionLabel = (page, input) => page.evaluate(inp => {
    const lbl = (inp.labels && inp.labels[0]) ||
        inp.closest('.fb-form-element__radio, .fb-form-element__checkbox, .artdeco-radio, .artdeco-checkbox, .jobs-easy-apply-form-element__radio')
            ?.querySelector('label');
    return lbl ? lbl.innerText.trim() : (inp.value || '');
}, input);

// Click the label of a radio/checkbox (React listens on the label), else the input
const clickOptionInput = (page, input) => page.evaluate(inp => {
    const lbl = (inp.labels && inp.labels[0]) ||
        inp.closest('.fb-form-element__radio, .fb-form-element__checkbox, .artdeco-radio, .artdeco-checkbox, .jobs-easy-apply-form-element__radio')
            ?.querySelector('label');
    if (lbl) lbl.click();
    else inp.click();
}, input);

// Click a visible [role=option] whose text matches; optionally fall back to the first one
const clickVisibleOption = (page, target, allowFirstFallback) => page.evaluate((t, allowFirst) => {
    const opts = Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="option"]'))
        .filter(el => el.offsetParent !== null);
    const tl = t.toLowerCase();
    for (const opt of opts) {
        const text = (opt.innerText || opt.textContent || '').trim().toLowerCase();
        if (text && (text === tl || text.includes(tl) || tl.includes(text))) { opt.click(); return true; }
    }
    if (allowFirst && opts.length > 0) { opts[0].click(); return true; }
    return false;
}, target, allowFirstFallback);

// ---------------------------------------------------------------------------
// Click a LinkedIn custom dropdown trigger, then the option matching optionText
// ---------------------------------------------------------------------------
const clickDropdownOption = async (page, triggerHandle, optionText) => {
    try {
        await triggerHandle.click();
        await sleep(300);
        return await page.evaluate((text) => {
            const candidates = Array.from(document.querySelectorAll(
                '[role="option"], .select__option, .fb-single-line-text__list-item, ' +
                '.jobs-easy-apply-form-element__select option, li[data-value]'
            ));
            for (const c of candidates) {
                const t = (c.innerText || c.textContent || '').trim().toLowerCase();
                if (t === text.toLowerCase() || t.includes(text.toLowerCase())) {
                    c.click();
                    return true;
                }
            }
            return false;
        }, String(optionText));
    } catch (e) {
        return false;
    }
};

// ---------------------------------------------------------------------------
// City/location typeahead: type slowly, wait for suggestions, click the match.
// Returns true only if a suggestion was selected.
// ---------------------------------------------------------------------------
const handleCombobox = async (page, inputHandle, textValue) => {
    try {
        const valString = String(textValue);
        await clearInput(page, inputHandle);
        await inputHandle.type(valString, { delay: randInt(60, 120) });
        await sleep(500); // typeahead network round-trip

        let dropdownFound = false;
        for (let wait = 0; wait < 6; wait++) {
            await sleep(500);
            dropdownFound = await page.evaluate((selectors) => {
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.offsetParent !== null) return true;
                }
                return false;
            }, TYPEAHEAD_SELECTORS);
            if (dropdownFound) break;
        }

        if (!dropdownFound) {
            console.log(`  Combobox: no dropdown appeared for "${valString}".`);
            if (cfg.strictAnswers) return false;
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            return false;
        }

        const clicked = await page.evaluate((val, selectors, allowFirst) => {
            const target = val.toLowerCase().trim();
            for (const sel of selectors) {
                for (const item of Array.from(document.querySelectorAll(sel))) {
                    const text = (item.innerText || item.textContent || '').toLowerCase().trim();
                    if (text && (text === target || text.includes(target) || target.includes(text))) {
                        item.click();
                        return true;
                    }
                }
            }
            if (!allowFirst) return false;
            for (const sel of selectors) {
                const first = document.querySelector(sel);
                if (first && first.offsetParent !== null) { first.click(); return true; }
            }
            return false;
        }, valString, TYPEAHEAD_SELECTORS, !cfg.strictAnswers);

        if (!clicked) {
            console.log(`  Combobox: no suggestion matched "${valString}".`);
            if (!cfg.strictAnswers) {
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('Enter');
            }
            return false;
        }

        console.log(`  Combobox: selected suggestion for "${valString}".`);
        return true;
    } catch (e) {
        console.log('  Combobox error:', e.message);
        return false;
    }
};

// ---------------------------------------------------------------------------
// Native <select>. Returns 'OK' | 'UNMATCHED' | 'SKIP_JOB'
// ---------------------------------------------------------------------------
const setSelectValue = async (page, selectHandle, value) => {
    try { await selectHandle.select(value); } catch (_) { /* hidden by custom styling — set below */ }
    // Force React binding to update
    await page.evaluate((el, val) => {
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, selectHandle, value);
};

const handleNativeSelect = async (page, selectHandle, value) => {
    try {
        const options = await page.evaluate(el => Array.from(el.options)
            .filter(o => o.value && !o.text.toLowerCase().includes('select'))
            .map(o => ({ value: o.value, text: o.text.trim() })), selectHandle);

        // Notice period: if "Immediate" is the only option, the job doesn't fit — skip it
        const isNoticePeriodSelect = await page.evaluate(el => {
            const container = el.closest('[class*="form"], [class*="grouping"], [class*="element"]');
            const label = container && container.querySelector('label, legend, span[class*="label"]');
            const text = label ? (label.innerText || '').toLowerCase() : '';
            return text.includes('notice') || text.includes('joining') || text.includes('how soon');
        }, selectHandle);

        if (isNoticePeriodSelect) {
            const nonImmediate = options.filter(o =>
                !o.text.toLowerCase().includes('immediate') && !o.text.toLowerCase().includes('instant'));
            if (nonImmediate.length === 0 && options.length > 0) {
                console.log('  ⚠️  Notice period dropdown has ONLY "Immediate" option — skipping this job.');
                return 'SKIP_JOB';
            }
        }

        const targetVal = String(value).toLowerCase();
        const match = options.find(o =>
            o.text.toLowerCase().includes(targetVal) || o.value.toLowerCase().includes(targetVal));
        if (match) {
            await setSelectValue(page, selectHandle, match.value);
            return 'OK';
        }
        if (options.length === 0) return 'UNMATCHED';

        // Score by word overlap
        const targetWords = targetVal.split(/\s+/);
        let bestScore = 0;
        let bestOption = null;
        for (const opt of options) {
            const optWords = opt.text.toLowerCase().split(/\s+/);
            const score = targetWords.filter(w => optWords.some(ow => ow.includes(w) || w.includes(ow))).length;
            if (score > bestScore) { bestScore = score; bestOption = opt; }
        }
        if (bestOption) {
            await setSelectValue(page, selectHandle, bestOption.value);
            return 'OK';
        }

        if (cfg.strictAnswers) return 'UNMATCHED';
        // Legacy last resort: second option (skip placeholder)
        const firstReal = options[options.length > 1 ? 1 : 0];
        await setSelectValue(page, selectHandle, firstReal.value);
        return 'OK';
    } catch (e) {
        console.error('Error handling select:', e.message);
        return 'UNMATCHED';
    }
};

// ---------------------------------------------------------------------------
// Per-type field handlers — return true if the field was filled
// ---------------------------------------------------------------------------
const fillSelect = async (page, group, answer) => {
    const selectHandle = await group.$('select');
    if (!selectHandle) return false;
    const result = await handleNativeSelect(page, selectHandle, answer);
    return result === 'SKIP_JOB' ? 'SKIP_JOB' : result === 'OK';
};

const fillCustomDropdown = async (page, group, q, answer, answers) => {
    const triggerHandle = await group.$(CUSTOM_DROPDOWN_SELECTOR);
    if (!triggerHandle) return false;
    await triggerHandle.click();
    await sleep(300);

    const availableOptions = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="option"]'))
            .filter(el => el.offsetParent !== null)
            .map(el => (el.innerText || el.textContent || '').trim()));

    const refinedAnswer = await getAnswer(q.questionText, answers,
        { type: 'custom-dropdown', options: availableOptions, source: 'linkedin', strict: cfg.strictAnswers });

    const clicked = await clickVisibleOption(page, String(refinedAnswer || answer), !cfg.strictAnswers);
    if (!clicked) await page.keyboard.press('Escape');
    return clicked;
};

const fillRadio = async (page, group, q, answer) => {
    const radioInputs = await group.$$('input[type="radio"]');
    const rData = [];
    for (const input of radioInputs) {
        const labelText = await getOptionLabel(page, input);
        rData.push({ input, labelText, labelLower: labelText.toLowerCase() });
    }

    const ansLower = String(answer).toLowerCase();
    const hasExactMatch = rData.some(r => r.labelLower === ansLower);
    const target = rData.find(r => hasExactMatch
        ? r.labelLower === ansLower
        : (r.labelLower && (r.labelLower.includes(ansLower) || ansLower.includes(r.labelLower))));

    if (!target) {
        console.log(`  ⚠️  Radio: no option matched "${answer}" for "${q.questionText}"`);
        console.log(`     Available: ${JSON.stringify(rData.map(r => r.labelText))}`);
        return false;
    }

    await clickOptionInput(page, target.input);
    // If React didn't register the label click, dispatch synthetic events
    const isChecked = await page.evaluate(el => el.checked, target.input);
    if (!isChecked) {
        await page.evaluate(inp => {
            const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked').set;
            nativeSet.call(inp, true);
            inp.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('input', { bubbles: true }));
        }, target.input);
    }
    console.log(`  ✔ Radio selected: "${target.labelText}"`);
    return true;
};

const AFFIRMATIVE = ['yes', 'true', '1', 'i agree', 'agree'];
const NEGATIVE = ['no', 'false', '0'];

const fillCheckbox = async (page, group, answer) => {
    const checkboxInputs = await group.$$('input[type="checkbox"]');
    const cbData = [];
    for (const cb of checkboxInputs) {
        cbData.push({ cb, labelLower: (await getOptionLabel(page, cb)).toLowerCase() });
    }

    const ansLower = String(answer).toLowerCase().trim();
    const setChecked = async (cb, want) => {
        const isChecked = await page.evaluate(el => el.checked, cb);
        if (isChecked !== want) {
            await clickOptionInput(page, cb);
            await page.evaluate(inp => inp.dispatchEvent(new Event('change', { bubbles: true })), cb);
        }
    };

    // Single checkbox (consent / acknowledgement): only untick on an explicit "no"
    if (cbData.length === 1) {
        const { cb, labelLower } = cbData[0];
        if (NEGATIVE.includes(ansLower)) await setChecked(cb, false);
        else if (AFFIRMATIVE.includes(ansLower) || labelLower.includes(ansLower) || ansLower.includes(labelLower)) await setChecked(cb, true);
        return true;
    }

    // Multi-select: tick matches; untick others only when at least one option matched
    const hasExactMatch = cbData.some(d => d.labelLower === ansLower);
    const matches = cbData.filter(({ labelLower }) => hasExactMatch
        ? labelLower === ansLower
        : (labelLower && (ansLower.includes(labelLower) || labelLower.includes(ansLower))));
    if (matches.length === 0) return false;
    for (const d of cbData) await setChecked(d.cb, matches.includes(d));
    return true;
};

const fillDate = async (page, group, answer) => {
    const dateInput = await group.$('input[type="date"]');
    if (!dateInput) return false;
    // Normalise DD/MM/YYYY (day > 12) or MM/DD/YYYY to YYYY-MM-DD
    let dateVal = String(answer);
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateVal)) {
        const parts = dateVal.split('/');
        const [m, d, y] = parseInt(parts[0], 10) > 12 ? [parts[1], parts[0], parts[2]] : parts;
        dateVal = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    await page.evaluate((el, val) => {
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSet.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, dateInput, dateVal);
    console.log(`  ✔ Date set: "${dateVal}"`);
    return true;
};

const fillText = async (page, getGroup, group, q, answer) => {
    const inputHandle = await group.$(TEXT_INPUT_SELECTOR);
    if (!inputHandle) return false;
    const answerStr = String(answer);

    const currentVal = await page.evaluate(el => el.value, inputHandle);
    if (currentVal === answerStr) return true;

    const qLower = q.questionText.toLowerCase();
    const isCityField = (
        qLower.includes('city') || qLower.includes('location') ||
        qLower.includes('where are you based') || qLower.includes('your location')
    ) && !qLower.includes('previous') && !qLower.includes('office') && !qLower.includes('address');

    const isCombobox = await page.evaluate(el =>
        el.getAttribute('role') === 'combobox' ||
        el.classList.contains('search-basic-typeahead-input') ||
        el.closest('.search-basic-typeahead') !== null ||
        el.hasAttribute('aria-autocomplete'), inputHandle);

    if (isCityField || isCombobox) {
        // Typeahead value differs from typed text, so a selected suggestion counts as filled
        if (await handleCombobox(page, inputHandle, answerStr)) return true;
    } else {
        await typeIntoInput(page, inputHandle, answerStr);
    }

    const finalVal = await page.evaluate(el => el.value, inputHandle);
    if (finalVal === answerStr) return true;

    console.log(`  Typing failed for "${q.questionText}". Checking for custom dropdown...`);
    const group2 = await getGroup();
    const customTrigger = group2 && await group2.$(CUSTOM_DROPDOWN_SELECTOR);
    if (customTrigger) {
        await customTrigger.click();
        await sleep(300);
        return clickVisibleOption(page, answerStr, !cfg.strictAnswers);
    }
    return clickDropdownOption(page, inputHandle, answerStr);
};

// Is this form group still empty in the DOM? (checkbox/custom dropdowns: unknown → false)
const isGroupEmpty = (page, idx) => page.evaluate((i) => {
    const g = document.querySelector(`[data-aagroup="${i}"]`);
    if (!g) return false;
    const radios = g.querySelectorAll('input[type="radio"]');
    if (radios.length) return !Array.from(radios).some(r => r.checked);
    const sel = g.querySelector('select');
    if (sel) {
        const opt = sel.options[sel.selectedIndex];
        return !sel.value || /^select/i.test((opt && opt.text) || '');
    }
    const txt = g.querySelector('input[type="text"], input[type="number"], input[type="tel"], input[type="email"], textarea');
    if (txt) return !txt.value.trim();
    return false;
}, idx);

// ---------------------------------------------------------------------------
// Fill every field on the current modal step.
// answerCache: shared across steps/retries of one application (saves LLM calls)
// Returns { status: 'OK' | 'SKIP_JOB' | 'NEEDS_ANSWER', unanswered: [...] }
// ---------------------------------------------------------------------------
const fillFormFields = async (page, answers, answerCache = new Map()) => {
    if (Object.keys(answers).length === 0) return { status: 'OK', unanswered: [] };

    // Stamp each group with data-aagroup so later lookups can't drift
    await page.evaluate((sel) => {
        Array.from(document.querySelectorAll(sel)).forEach((g, i) => g.setAttribute('data-aagroup', String(i)));
    }, GROUP_SELECTOR);

    const formGroups = await page.evaluate((customDropSel) => {
        return Array.from(document.querySelectorAll('[data-aagroup]')).map((g) => {
            const idx = parseInt(g.getAttribute('data-aagroup'), 10);

            const labelEl =
                g.querySelector('legend') ||
                g.querySelector('[data-test-form-builder-radio-button-form-component__title]') ||
                g.querySelector('[data-test-form-element-label]') ||
                g.querySelector('.fb-dash-form-element__label') ||
                g.querySelector('.fb-form-element-label') ||
                g.querySelector('.artdeco-text-input__label') ||
                g.querySelector('label') ||
                g.querySelector('span.t-14') ||
                g.querySelector('h3.t-14') ||
                g.querySelector('.jobs-easy-apply-form-element span[aria-hidden="true"]') ||
                g.querySelector('.jobs-easy-apply-form-section__grouping span.visually-hidden');

            const optionLabel = (inp) => {
                const lbl = (inp.labels && inp.labels[0]) ||
                    inp.closest('.fb-form-element__radio, .fb-form-element__checkbox, .artdeco-radio, .artdeco-checkbox, .jobs-easy-apply-form-element__radio')
                        ?.querySelector('label');
                return lbl ? lbl.innerText.trim() : (inp.value || '');
            };

            let type = 'text';
            let options = [];
            const selectEl = g.querySelector('select');
            const radioInputs = Array.from(g.querySelectorAll('input[type="radio"]'));
            const checkboxInputs = Array.from(g.querySelectorAll('input[type="checkbox"]'));

            if (selectEl) {
                type = 'select';
                options = Array.from(selectEl.options)
                    .filter(o => o.value && !o.text.toLowerCase().includes('select'))
                    .map(o => o.text.trim());
            } else if (radioInputs.length > 0) {
                type = 'radio';
                options = radioInputs.map(optionLabel).filter(Boolean);
            } else if (checkboxInputs.length > 0) {
                type = 'checkbox';
                options = checkboxInputs.map(optionLabel).filter(Boolean);
            } else if (g.querySelector('input[type="date"]')) {
                type = 'date';
            } else if (g.querySelector(customDropSel)) {
                type = 'custom-dropdown';
            }

            const required = !!g.querySelector('[required], [aria-required="true"]');
            return { idx, questionText: labelEl ? labelEl.innerText.trim() : '', type, options, required };
        }).filter(g => g.questionText !== '');
    }, CUSTOM_DROPDOWN_SELECTOR);

    // LinkedIn nests matching wrappers — dedupe by (question, type)
    const seenKeys = new Set();
    const uniqueFormGroups = formGroups.filter(({ questionText, type }) => {
        const key = `${questionText.toLowerCase().trim()}||${type}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
    });

    const unanswered = [];

    for (const q of uniqueFormGroups) {
        const { idx, questionText, type, options } = q;

        const cacheKey = `${questionText.toLowerCase().trim()}||${type}`;
        let answer;
        if (answerCache.has(cacheKey)) {
            answer = answerCache.get(cacheKey);
        } else {
            answer = await getAnswer(questionText, answers, { type, options, source: 'linkedin', strict: cfg.strictAnswers });
            answerCache.set(cacheKey, answer);
        }

        // Month selects ("From"/"To" in experience sections) must match an option
        const isMonthField = type === 'select' && options.length >= 3 &&
            MONTHS.some(m => options.some(o => o.toLowerCase().startsWith(m)));

        let effectiveAnswer;
        if (isMonthField) {
            const ansLower = String(answer || '').toLowerCase();
            effectiveAnswer = (ansLower && options.find(o => o.toLowerCase().includes(ansLower) || ansLower.includes(o.toLowerCase()))) || options[0];
        } else if (answer === null || answer === undefined || answer === '') {
            console.log(`  ⚠️  [UNANSWERED] "${questionText}" (type: ${type}${options.length ? ', options: ' + JSON.stringify(options.slice(0, 5)) : ''})`);
            if (!cfg.strictAnswers && (type === 'radio' || type === 'select') && options.length > 0) {
                console.log(`  ↳ Auto-fallback: using first option "${options[0]}"`);
                effectiveAnswer = options[0];
            } else {
                if (q.required && await isGroupEmpty(page, idx)) unanswered.push(q);
                continue;
            }
        } else {
            effectiveAnswer = String(answer);
        }

        const getGroup = () => page.$(`[data-aagroup="${idx}"]`);
        console.log(`  [Q${idx}] "${questionText}" (${type}) → answer: "${effectiveAnswer}"${options.length ? ' | options: ' + JSON.stringify(options.slice(0, 4)) : ''}`);

        let filled = false;
        try {
            const group = await getGroup();
            if (!group) continue;
            if (type === 'select') filled = await fillSelect(page, group, effectiveAnswer);
            else if (type === 'custom-dropdown') filled = await fillCustomDropdown(page, group, q, effectiveAnswer, answers);
            else if (type === 'radio') filled = await fillRadio(page, group, q, effectiveAnswer);
            else if (type === 'checkbox') filled = await fillCheckbox(page, group, effectiveAnswer);
            else if (type === 'date') filled = await fillDate(page, group, effectiveAnswer);
            else filled = await fillText(page, getGroup, group, q, effectiveAnswer);
        } catch (e) {
            console.log(`  Warning: could not fill ${type} for "${questionText}":`, e.message);
        }

        if (filled === 'SKIP_JOB') return { status: 'SKIP_JOB', unanswered };
        if (!filled && q.required && await isGroupEmpty(page, idx)) {
            unanswered.push({ ...q, attempted: effectiveAnswer });
        }
    }

    if (unanswered.length > 0 && cfg.strictAnswers) return { status: 'NEEDS_ANSWER', unanswered };
    return { status: 'OK', unanswered };
};

module.exports = { fillFormFields, sleep, randInt };
