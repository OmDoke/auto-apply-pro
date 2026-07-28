const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { getAnswer } = require('../utils/questionAnswerer');

// ---------------------------------------------------------------------------
// Logging helpers — timestamp + elapsed timer
// ---------------------------------------------------------------------------
// ts() → "[HH:MM:SS.mmm]" prefix for every log line
const ts = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `[${hh}:${mm}:${ss}.${ms}]`;
};

// timer() → call start = timer(), then log(start, 'label') to print elapsed ms
const timer = () => Date.now();
const elapsed = (start) => `(${Date.now() - start}ms)`;

// Wrap the native console.log to auto-prepend timestamp
const _log = console.log.bind(console);
console.log = (...args) => _log(ts(), ...args);

// answers.json is loaded fresh each run — see loadAnswers() helper
const answersPath = path.join(__dirname, '..', 'data', 'answers.json');

// Load answers fresh from disk (called at the start of each run)
const loadAnswers = () => {
    try {
        if (fs.existsSync(answersPath)) {
            return JSON.parse(fs.readFileSync(answersPath, 'utf8'));
        }
    } catch (err) {
        console.error('Could not parse answers.json:', err);
    }
    return {};
};

// Resume path from backend/data
const resumePath = path.join(__dirname, '..', 'data', 'onkar_resume.pdf');

// Path to persist failed jobs
const failedJobsPath = path.join(__dirname, '..', 'data', 'failed_jobs.json');

// Helper: merge & save failed jobs to disk
const saveFailedJobs = (failedJobs) => {
    try {
        let existing = [];
        if (fs.existsSync(failedJobsPath)) {
            existing = JSON.parse(fs.readFileSync(failedJobsPath, 'utf8'));
        }
        const merged = [...existing, ...failedJobs];
        fs.writeFileSync(failedJobsPath, JSON.stringify(merged, null, 2));
        console.log(`Failed jobs saved to failed_jobs.json (total: ${merged.length})`);
    } catch (e) {
        console.log('Could not save failed_jobs.json:', e.message);
    }
};

const appliedJobsPath = path.join(__dirname, '..', 'data', 'applied_jobs.json');

const isJobApplied = (title) => {
    try {
        if (fs.existsSync(appliedJobsPath)) {
            const existing = JSON.parse(fs.readFileSync(appliedJobsPath, 'utf8'));
            return existing.some(j => j.title.toLowerCase() === title.toLowerCase());
        }
    } catch (e) {}
    return false;
};

const recordAppliedJob = (title, url) => {
    try {
        let existing = [];
        if (fs.existsSync(appliedJobsPath)) {
            existing = JSON.parse(fs.readFileSync(appliedJobsPath, 'utf8'));
        }
        if (!existing.some(j => j.title.toLowerCase() === title.toLowerCase() || (j.url && url && j.url === url))) {
            existing.push({ title, url, appliedAt: new Date().toISOString() });
            fs.writeFileSync(appliedJobsPath, JSON.stringify(existing, null, 2));
        }
    } catch (e) {
        console.log('Could not save applied_jobs.json:', e.message);
    }
};

// Helper: close the Easy Apply modal by clicking Dismiss, then Discard if needed
const discardModal = async (page) => {
    try {
        const dismissBtn = await page.$('button[aria-label="Dismiss"]');
        if (dismissBtn) await dismissBtn.click();
        // await new Promise(r => setTimeout(r, 50));
        // Confirm discard if prompted
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            for (const b of btns) {
                if (b.innerText && b.innerText.toLowerCase().includes('discard')) {
                    b.click();
                    return;
                }
            }
        });
        // await new Promise(r => setTimeout(r, 50));
    } catch (e) {
        // ignore
    }
};

// ---------------------------------------------------------------------------
// Helper: type a value into a text/number input the correct way.
// Implements the "hidden zero bug fix" sequence:
//   Click → Ctrl+A → Delete → wait 500ms → type → verify
// ---------------------------------------------------------------------------
const typeIntoInput = async (page, elementHandle, value) => {
    await elementHandle.click({ clickCount: 3 }); // triple-click selects all
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Delete');
    // await new Promise(r => setTimeout(r, 50));
    await elementHandle.type(String(value));

    // Verify what's in the field
    const actual = await page.evaluate(el => el.value, elementHandle);
    if (actual !== String(value)) {
        // Retry once
        await elementHandle.click({ clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.press('Delete');
        // await new Promise(r => setTimeout(r, 50));
        await elementHandle.type(String(value));
    }
};

// ---------------------------------------------------------------------------
// Helper: click a LinkedIn custom dropdown, wait 1s, then click option by text.
// Returns true if successful.
// ---------------------------------------------------------------------------
const clickDropdownOption = async (page, triggerHandle, optionText) => {
    try {
        await triggerHandle.click();
        // await new Promise(r => setTimeout(r, 50)); // wait for options to populate

        // Try to find and click the option in the newly opened listbox
        const clicked = await page.evaluate((text) => {
            // Standard <option> inside <select>
            // Custom listbox items: [role="option"], [data-value], li elements in a dropdown
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
        }, optionText);

        // await new Promise(r => setTimeout(r, 50));
        return clicked;
    } catch (e) {
        return false;
    }
};

// ---------------------------------------------------------------------------
// Helper: handle LinkedIn city/location autocomplete fields.
// LinkedIn uses a typeahead component — you must type slowly, wait for the
// suggestion list to appear, then CLICK the first matching suggestion.
// Returns true if a suggestion was selected, false if timed out.
// ---------------------------------------------------------------------------
const handleCombobox = async (page, inputHandle, textValue) => {
    try {
        const valString = String(textValue);

        // Step 1: Clear the field
        await inputHandle.click({ clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.press('Delete');
        // await new Promise(r => setTimeout(r, 50));

        // Step 2: Type slowly to trigger LinkedIn's typeahead API
        await inputHandle.type(valString, { delay: 50 });
        await new Promise(r => setTimeout(r, 500)); // wait for network response

        // Step 3: Wait for autocomplete dropdown to appear (up to 3 seconds)
        const dropdownSelectors = [
            '[role="listbox"]',
            '[role="option"]',
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

        let dropdownFound = false;
        for (let wait = 0; wait < 6; wait++) {
            await new Promise(r => setTimeout(r, 500));
            dropdownFound = await page.evaluate((selectors) => {
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.offsetParent !== null) return true;
                }
                return false;
            }, dropdownSelectors);
            if (dropdownFound) break;
        }

        if (!dropdownFound) {
            console.log(`  Combobox: no dropdown appeared for "${valString}", pressing Enter as fallback.`);
            await page.keyboard.press('ArrowDown');
            // await new Promise(r => setTimeout(r, 50));
            await page.keyboard.press('Enter');
            return false;
        }

        // Step 4: Click the first suggestion that matches our value
        const clicked = await page.evaluate((val) => {
            const allSelectors = [
                '[role="option"]',
                '[role="listbox"] li',
                '.basic-typeahead__selectable',
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
            for (const sel of allSelectors) {
                const items = Array.from(document.querySelectorAll(sel));
                for (const item of items) {
                    const text = (item.innerText || item.textContent || '').toLowerCase().trim();
                    const target = val.toLowerCase().trim();
                    if (text === target || text.includes(target) || target.includes(text)) {
                        item.click();
                        return true;
                    }
                }
            }
            // Fallback: click first visible option regardless of text
            for (const sel of allSelectors) {
                const first = document.querySelector(sel);
                if (first && first.offsetParent !== null) {
                    first.click();
                    return true;
                }
            }
            return false;
        }, valString);

        // await new Promise(r => setTimeout(r, 50));

        if (!clicked) {
            // Last resort: keyboard navigation
            await page.keyboard.press('ArrowDown');
            // await new Promise(r => setTimeout(r, 50));
            await page.keyboard.press('Enter');
        }

        console.log(`  Combobox: selected suggestion for "${valString}".`);
        return true;
    } catch (e) {
        console.log('  Combobox error:', e.message);
        return false;
    }
};

// ---------------------------------------------------------------------------
// Helper: handle native <select> elements.
// ---------------------------------------------------------------------------
const handleNativeSelect = async (page, selectHandle, value) => {
    try {
        // Check if this is a notice period field and if "Immediate" is the only option
        const options = await page.evaluate(el => {
            return Array.from(el.options)
                .filter(o => o.value && !o.text.toLowerCase().includes('select'))
                .map(o => ({ value: o.value, text: o.text.trim() }));
        }, selectHandle);

        // Notice period check: if only option is "Immediate", signal to skip the job
        const isNoticePeriodSelect = await page.evaluate(el => {
            const container = el.closest('[class*="form"], [class*="grouping"], [class*="element"]');
            if (!container) return false;
            const label = container.querySelector('label, legend, span[class*="label"]');
            if (!label) return false;
            const text = (label.innerText || '').toLowerCase();
            return text.includes('notice') || text.includes('joining') || text.includes('how soon');
        }, selectHandle);

        if (isNoticePeriodSelect) {
            const nonImmediate = options.filter(o =>
                !o.text.toLowerCase().includes('immediate') &&
                !o.text.toLowerCase().includes('instant')
            );
            if (nonImmediate.length === 0 && options.length > 0) {
                console.log('  ⚠️  Notice period dropdown has ONLY "Immediate" option — skipping this job.');
                return 'SKIP_JOB';
            }
        }

        // Try to find the best matching option
        const targetVal = String(value).toLowerCase();
        const match = options.find(o =>
            o.text.toLowerCase().includes(targetVal) ||
            o.value.toLowerCase().includes(targetVal)
        );

        if (match) {
            try {
                await selectHandle.select(match.value);
            } catch (err) {
                // If Puppeteer native select fails (e.g. element is hidden by custom styling), fallback to evaluate
            }
            
            // Force React binding to update
            await page.evaluate((el, val) => {
                el.value = val;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }, selectHandle, match.value);
            
            // await new Promise(r => setTimeout(r, 50));
        } else if (options.length > 0) {
            // After the first match attempt, if no match found, try scoring by word overlap
            const targetWords = targetVal.split(/\s+/);
            let bestScore = 0;
            let bestOption = null;
            for (const opt of options) {
                const optWords = opt.text.toLowerCase().split(/\s+/);
                const score = targetWords.filter(w => optWords.some(ow => ow.includes(w) || w.includes(ow))).length;
                if (score > bestScore) { bestScore = score; bestOption = opt; }
            }
            if (bestScore > 0 && bestOption) {
                try { await selectHandle.select(bestOption.value); } catch(err) {}
                await page.evaluate((el, val) => {
                    el.value = val;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                }, selectHandle, bestOption.value);
                // await new Promise(r => setTimeout(r, 50));
            } else {
                // Last resort: select the second option (skip placeholder)
                const firstReal = options[options.length > 1 ? 1 : 0];
                if (firstReal) {
                    try { await selectHandle.select(firstReal.value); } catch(err) {}
                    await page.evaluate((el, val) => {
                        el.value = val;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }, selectHandle, firstReal.value);
                    // await new Promise(r => setTimeout(r, 50));
                }
            }
        }
        return 'OK';
    } catch (e) {
        console.error('Error handling select:', e.message);
        return 'OK';
    }
};

// ---------------------------------------------------------------------------
// Core: fill all form fields on the current modal step.
// Uses real Puppeteer interactions — no JS injection for values.
// ---------------------------------------------------------------------------
const fillFormFields = async (page, answers) => {
    if (Object.keys(answers).length === 0) return 'OK';

    // ── TASK 2 FIX: Stamp each group with data-aagroup to prevent DOM drift ──
    const GROUP_SELECTOR =
        '.jobs-easy-apply-form-section__grouping, ' +
        '.fb-dash-form-element, ' +
        '.jobs-easy-apply-form-element__fields, ' +
        '.jobs-easy-apply-form-element, ' +
        'fieldset.fb-form-element, ' +
        '.artdeco-form-item, ' +
        '.artdeco-text-input--container';

    // ── TASK 8: Widen custom-dropdown detector to catch LinkedIn data-test-* variants ──
    const CUSTOM_DROPDOWN_SELECTOR =
        'button[aria-haspopup="listbox"], ' +
        'button[aria-expanded="false"][aria-haspopup], ' +
        '[role="combobox"]:not(input):not(textarea), ' +
        '.artdeco-dropdown__trigger, ' +
        '.fb-form-element-label + div button, ' +
        'button[data-test-text-entity-list-form-select], ' +
        'button[data-test-single-typeahead-entity-form-component]';

    await page.evaluate((sel) => {
        const groups = Array.from(document.querySelectorAll(sel));
        groups.forEach((g, i) => g.setAttribute('data-aagroup', String(i)));
    }, GROUP_SELECTOR);

    // Collect all form groups with their metadata
    const formGroups = await page.evaluate((customDropSel) => {
        const groups = Array.from(document.querySelectorAll('[data-aagroup]'));
        return groups.map((g) => {
            const idx = parseInt(g.getAttribute('data-aagroup'), 10);

            // ── Label extraction — covers all LinkedIn question patterns ──
            let labelEl =
                g.querySelector('legend') ||
                g.querySelector('[data-test-form-builder-radio-button-form-component__title]') ||
                g.querySelector('[data-test-form-element-label]') ||
                g.querySelector('.fb-dash-form-element__label') ||
                g.querySelector('.fb-form-element-label') ||
                g.querySelector('.artdeco-text-input__label') ||
                g.querySelector('label');

            if (!labelEl) {
                labelEl =
                    g.querySelector('span.t-14') ||
                    g.querySelector('h3.t-14') ||
                    g.querySelector('.jobs-easy-apply-form-element span[aria-hidden="true"]') ||
                    g.querySelector('.jobs-easy-apply-form-section__grouping span.visually-hidden');
            }

            let type = 'text';
            let options = [];

            const selectEl = g.querySelector('select');
            const customDropdownBtn = g.querySelector(customDropSel);
            const radioInputs = Array.from(g.querySelectorAll('input[type="radio"]'));
            const checkboxInputs = Array.from(g.querySelectorAll('input[type="checkbox"]'));
            const dateInput = g.querySelector('input[type="date"]');

            if (selectEl) {
                type = 'select';
                options = Array.from(selectEl.options)
                    .filter(o => o.value && !o.text.toLowerCase().includes('select'))
                    .map(o => o.text.trim());
            } else if (radioInputs.length > 0) {
                // ── TASK 1 FIX: Detect radio by input[type="radio"] not by label count ──
                type = 'radio';
                options = radioInputs.map(inp => {
                    const lbl = inp.id
                        ? document.querySelector(`label[for="${inp.id}"]`)
                        : inp.closest('.fb-form-element__radio, .artdeco-radio, .jobs-easy-apply-form-element__radio')
                            ?.querySelector('label');
                    return lbl ? lbl.innerText.trim() : (inp.value || '');
                }).filter(Boolean);
            } else if (checkboxInputs.length > 0) {
                // ── TASK 7: Detect checkbox groups (including single checkboxes) ──
                type = 'checkbox';
                options = checkboxInputs.map(inp => {
                    const lbl = inp.id
                        ? document.querySelector(`label[for="${inp.id}"]`)
                        : inp.closest('.fb-form-element__checkbox, .artdeco-checkbox')?.querySelector('label');
                    return lbl ? lbl.innerText.trim() : (inp.value || '');
                }).filter(Boolean);
            } else if (dateInput) {
                // ── TASK 11: Detect date-picker inputs ──
                type = 'date';
            } else if (customDropdownBtn) {
                type = 'custom-dropdown';
            }

            return { idx, questionText: labelEl ? labelEl.innerText.trim() : '', type, options };
        }).filter(g => g.questionText !== '');
    }, CUSTOM_DROPDOWN_SELECTOR);

    // Deduplicate groups by (questionText, type) — LinkedIn sometimes stamps duplicate DOM
    // elements for the same field (causing the same LLM call to be made twice)
    const seenKeys = new Set();
    const uniqueFormGroups = formGroups.filter(({ questionText, type }) => {
        const key = `${questionText.toLowerCase().trim()}||${type}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
    });

    // Per-fill answer cache — each unique question is resolved at most once per fill pass
    const answerCache = new Map();

    for (const { idx, questionText, type, options } of uniqueFormGroups) {
        // ── Month/year selects ("From", "To", "Start", "End") must match from options, not from generic answers ──
        // These fields appear in experience/education sections with month options like ["January","February",...]
        const isMonthField = type === 'select' && options.length >= 3 &&
            ['january','february','march','april','may','june','july','august','september','october','november','december']
                .some(m => options.some(o => o.toLowerCase().startsWith(m)));

        // Get the best answer for this question (use cache to avoid duplicate LLM calls)
        const cacheKey = `${questionText.toLowerCase().trim()}||${type}`;
        let answer;
        if (answerCache.has(cacheKey)) {
            answer = answerCache.get(cacheKey);
        } else {
            answer = await getAnswer(questionText, answers, { type, options, source: 'linkedin' });
            answerCache.set(cacheKey, answer);
        }

        // For month selects: if the resolved answer isn't in the options list, skip to avoid wrong value
        let effectiveAnswer;
        if (isMonthField) {
            const ansLower = (answer || '').toLowerCase();
            const matchedMonth = options.find(o => o.toLowerCase().includes(ansLower) || ansLower.includes(o.toLowerCase()));
            if (matchedMonth) {
                effectiveAnswer = matchedMonth;
            } else {
                // Default to first month option (January) rather than a numeric/wrong answer
                effectiveAnswer = options[0];
                console.log(`  ℹ️  Month field "${questionText}": defaulting to "${effectiveAnswer}"`);
            }
        } else {
            // ── TASK 5 FIX: Log unanswered questions — never silently skip ──
            if (!answer) {
                console.log(`  ⚠️  [UNANSWERED] "${questionText}" (type: ${type}${options.length ? ', options: ' + JSON.stringify(options.slice(0, 5)) : ''})`);
                // For radio/select/checkbox with options, auto-select first as fallback
                if ((type === 'radio' || type === 'select' || type === 'checkbox') && options.length > 0) {
                    console.log(`  ↳ Auto-fallback: using first option "${options[0]}"`);
                } else {
                    continue;
                }
            }
            effectiveAnswer = answer || options[0];
        }

        // ── TASK 2: Always look up by data-aagroup to avoid index drift ──
        const getGroup = () => page.$(`[data-aagroup="${idx}"]`);

        console.log(`  [Q${idx}] "${questionText}" (${type}) → answer: "${effectiveAnswer}"${options.length ? ' | options: ' + JSON.stringify(options.slice(0, 4)) : ''}`);

        if (type === 'select') {
            try {
                const group = await getGroup();
                if (!group) continue;
                const selectHandle = await group.$('select');
                if (!selectHandle) continue;
                const result = await handleNativeSelect(page, selectHandle, effectiveAnswer);
                if (result === 'SKIP_JOB') return 'SKIP_JOB';
            } catch (e) {
                console.log(`  Warning: could not fill select for "${questionText}":`, e.message);
            }

        } else if (type === 'custom-dropdown') {
            try {
                const group = await getGroup();
                if (!group) continue;
                const triggerHandle = await group.$(CUSTOM_DROPDOWN_SELECTOR);
                if (!triggerHandle) continue;

                await triggerHandle.click();
                // await new Promise(r => setTimeout(r, 50));

                const availableOptions = await page.evaluate(() =>
                    Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="option"]'))
                        .filter(el => el.offsetParent !== null)
                        .map(el => (el.innerText || el.textContent || '').trim())
                );

                const refinedAnswer = await getAnswer(questionText, answers, { type: 'custom-dropdown', options: availableOptions, source: 'linkedin' });

                const clicked = await page.evaluate((target) => {
                    const opts = Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="option"]'))
                        .filter(el => el.offsetParent !== null);
                    for (const opt of opts) {
                        const text = (opt.innerText || opt.textContent || '').trim().toLowerCase();
                        if (text === target.toLowerCase() || text.includes(target.toLowerCase()) || target.toLowerCase().includes(text)) {
                            opt.click();
                            return true;
                        }
                    }
                    if (opts.length > 0) { opts[0].click(); return true; }
                    return false;
                }, refinedAnswer || effectiveAnswer);

                if (!clicked) await page.keyboard.press('Escape');
                // await new Promise(r => setTimeout(r, 50));
            } catch (e) {
                console.log(`  Warning: could not fill custom dropdown for "${questionText}":`, e.message);
            }

        } else if (type === 'radio') {
            // ── TASK 1 FIX: React-compatible radio dispatch via input[type="radio"] ──
            try {
                const group = await getGroup();
                if (!group) continue;

                const radioInputs = await group.$$('input[type="radio"]');
                let clicked = false;

                for (const input of radioInputs) {
                    const labelText = await page.evaluate(inp => {
                        const id = inp.id;
                        const lbl = id
                            ? document.querySelector(`label[for="${id}"]`)
                            : inp.closest('.fb-form-element__radio, .artdeco-radio, .jobs-easy-apply-form-element__radio')
                                ?.querySelector('label');
                        return lbl ? lbl.innerText.trim() : (inp.value || '');
                    }, input);

                    if (
                        labelText.toLowerCase() === effectiveAnswer.toLowerCase() ||
                        labelText.toLowerCase().includes(effectiveAnswer.toLowerCase()) ||
                        effectiveAnswer.toLowerCase().includes(labelText.toLowerCase())
                    ) {
                        // Method 1: Click the associated label
                        await page.evaluate(inp => {
                            const id = inp.id;
                            const lbl = id
                                ? document.querySelector(`label[for="${id}"]`)
                                : inp.closest('.fb-form-element__radio, .artdeco-radio, .jobs-easy-apply-form-element__radio')
                                    ?.querySelector('label');
                            if (lbl) lbl.click();
                            else inp.click();
                        }, input);
                        // await new Promise(r => setTimeout(r, 50));

                        // Method 2: If still not checked, dispatch React-compatible synthetic events
                        const isChecked = await page.evaluate(el => el.checked, input);
                        if (!isChecked) {
                            await page.evaluate(inp => {
                                const nativeSet = Object.getOwnPropertyDescriptor(
                                    window.HTMLInputElement.prototype, 'checked'
                                ).set;
                                nativeSet.call(inp, true);
                                inp.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                inp.dispatchEvent(new Event('change', { bubbles: true }));
                                inp.dispatchEvent(new Event('input', { bubbles: true }));
                            }, input);
                            // await new Promise(r => setTimeout(r, 50));
                        }

                        clicked = true;
                        console.log(`  ✔ Radio selected: "${labelText}"`);
                        break;
                    }
                }

                if (!clicked) {
                    const availableLabels = await Promise.all(radioInputs.map(inp =>
                        page.evaluate(inp => {
                            const id = inp.id;
                            const lbl = id ? document.querySelector(`label[for="${id}"]`) : null;
                            return lbl ? lbl.innerText.trim() : (inp.value || '');
                        }, inp)
                    ));
                    console.log(`  ⚠️  Radio: no option matched "${effectiveAnswer}" for "${questionText}"`);
                    console.log(`     Available: ${JSON.stringify(availableLabels)}`);
                }
            } catch (e) {
                console.log(`  Warning: could not fill radio for "${questionText}":`, e.message);
            }

        } else if (type === 'checkbox') {
            // ── TASK 7: Multi-select checkbox handling ──
            try {
                const group = await getGroup();
                if (!group) continue;

                const checkboxInputs = await group.$$('input[type="checkbox"]');
                for (const cb of checkboxInputs) {
                    const labelText = await page.evaluate(cb => {
                        const lbl = cb.id
                            ? document.querySelector(`label[for="${cb.id}"]`)
                            : cb.closest('.fb-form-element__checkbox')?.querySelector('label');
                        return lbl ? lbl.innerText.trim() : (cb.value || '');
                    }, cb);

                    const ansLower = effectiveAnswer.toLowerCase();
                    const labelLower = labelText.toLowerCase();
                    const isSingleCheckbox = checkboxInputs.length === 1;

                    const shouldCheck = 
                        (isSingleCheckbox && (ansLower === 'yes' || ansLower === 'true' || ansLower === '1')) ||
                        ansLower.includes(labelLower) ||
                        labelLower.includes(ansLower);

                    if (shouldCheck) {
                        const isChecked = await page.evaluate(el => el.checked, cb);
                        if (!isChecked) {
                            await page.evaluate(inp => {
                                const lbl = inp.id ? document.querySelector(`label[for="${inp.id}"]`) : null;
                                if (lbl) lbl.click();
                                else inp.click();
                                inp.dispatchEvent(new Event('change', { bubbles: true }));
                            }, cb);
                            // await new Promise(r => setTimeout(r, 50));
                        }
                    }
                }
            } catch (e) {
                console.log(`  Warning: could not fill checkbox for "${questionText}":`, e.message);
            }

        } else if (type === 'date') {
            // ── TASK 11: Date-picker input handling ──
            try {
                const group = await getGroup();
                if (!group) continue;
                const dateInput = await group.$('input[type="date"]');
                if (!dateInput) continue;
                // Normalise to YYYY-MM-DD
                // Supports: DD/MM/YYYY (Indian), MM/DD/YYYY (US), or YYYY-MM-DD
                let dateVal = effectiveAnswer;
                if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateVal)) {
                    const parts = dateVal.split('/');
                    const firstNum = parseInt(parts[0]);
                    // If first part > 12, it's DD/MM/YYYY (day > 12 can't be a month)
                    if (firstNum > 12) {
                        // DD/MM/YYYY → YYYY-MM-DD
                        const [d, m, y] = parts;
                        dateVal = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
                    } else {
                        // MM/DD/YYYY → YYYY-MM-DD
                        const [m, d, y] = parts;
                        dateVal = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
                    }
                }
                await page.evaluate((el, val) => {
                    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    nativeSet.call(el, val);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }, dateInput, dateVal);
                // await new Promise(r => setTimeout(r, 50));
                console.log(`  ✔ Date set: "${dateVal}"`);
            } catch (e) {
                console.log(`  Warning: could not fill date for "${questionText}":`, e.message);
            }

        } else {
            // Text / number / email / tel / textarea
            try {
                const group = await getGroup();
                if (!group) continue;

                const inputHandle = await group.$(
                    'input[type="text"], input[type="number"], input[type="tel"], ' +
                    'input[type="email"], textarea, .fb-single-line-text__input'
                );
                if (!inputHandle) continue;

                const currentVal = await page.evaluate(el => el.value, inputHandle);
                if (currentVal === String(effectiveAnswer)) continue;

                const qLower = questionText.toLowerCase();
                const isCityField = (
                    qLower.includes('city') ||
                    qLower.includes('location') ||
                    qLower.includes('where are you based') ||
                    qLower.includes('your location')
                ) && !qLower.includes('previous') && !qLower.includes('office')
                  && !qLower.includes('address');

                const isCombobox = await page.evaluate(el => {
                    return el.getAttribute('role') === 'combobox' ||
                           el.classList.contains('search-basic-typeahead-input') ||
                           el.closest('.search-basic-typeahead') !== null ||
                           el.hasAttribute('aria-autocomplete');
                }, inputHandle);

                if (isCityField || isCombobox) {
                    // Combobox/city: handleCombobox selects from dropdown — value may differ from typed text
                    // so we only fall through to custom-dropdown check if NO suggestion was selected at all
                    const comboSelected = await handleCombobox(page, inputHandle, effectiveAnswer);
                    if (comboSelected) continue; // suggestion was picked — no further action needed
                } else {
                    await typeIntoInput(page, inputHandle, effectiveAnswer);
                }

                const finalVal = await page.evaluate(el => el.value, inputHandle);
                if (finalVal !== String(effectiveAnswer)) {
                    console.log(`  Typing failed for "${questionText}". Checking for custom dropdown...`);
                    const group2 = await getGroup();
                    const customTrigger = group2 && await group2.$(CUSTOM_DROPDOWN_SELECTOR);
                    if (customTrigger) {
                        await customTrigger.click();
                        // await new Promise(r => setTimeout(r, 50));
                        await page.evaluate((val) => {
                            const opts = Array.from(document.querySelectorAll('[role="option"]')).filter(e => e.offsetParent !== null);
                            for (const o of opts) {
                                if ((o.innerText || '').toLowerCase().includes(val.toLowerCase())) { o.click(); return; }
                            }
                            if (opts[0]) opts[0].click();
                        }, effectiveAnswer);
                    } else {
                        await clickDropdownOption(page, inputHandle, effectiveAnswer);
                    }
                }

                // await new Promise(r => setTimeout(r, 50));
            } catch (e) {
                console.log(`  Warning: could not fill text for "${questionText}":`, e.message);
            }
        }
    }

    // await new Promise(r => setTimeout(r, 50));
    return 'OK';
};

// ---------------------------------------------------------------------------
// Helper: upload the generated resume, falling back to selecting by name
// ---------------------------------------------------------------------------
const handleResumeStep = async (page, answers = {}) => {
    let uploaded = false;

    // 1. Always prioritize uploading the newly generated resume
    if (fs.existsSync(resumePath)) {
        const fileInputs = await page.$$('input[type="file"]');
        if (fileInputs.length > 0) {
            console.log(`  Found ${fileInputs.length} file input(s) on this step.`);
            for (const input of fileInputs) {
                try {
                    const uploadStart = timer();
                    await input.uploadFile(resumePath);
                    console.log('  Resume uploaded from file: onkar_resume.pdf. Waiting for LinkedIn to process...');
                    // Poll until LinkedIn's upload indicator disappears (max ~3s)
                    for (let u = 0; u < 15; u++) {
                        const uploading = await page.evaluate(() => {
                            const prog = document.querySelector('[class*="upload"][class*="progress"], [class*="uploading"], .jobs-easy-apply-resume-upload__uploading');
                            return !!(prog && prog.offsetParent !== null);
                        });
                        if (!uploading) break;
                        await new Promise(r => setTimeout(r, 200));
                    }
                    console.log(`  ✔ Resume upload processed ${elapsed(uploadStart)}`);
                    uploaded = true;
                    break;
                } catch (err) {
                    console.log('  Failed to upload resume:', err.message);
                }
            }
        }
        
        // If onkar_resume.pdf exists, we NEVER want to fallback to selecting an old, stale resume by name.
        // Even if we didn't find a file input on this specific step, we return early.
        return;
    } else {
        console.log('  onkar_resume.pdf not found at backend/data/onkar_resume.pdf.');
    }

    // 2. Fallback to selecting an existing resume by name (only if no dynamic resume exists)
    const targetResume = process.env.RESUME_NAME || answers['resume name'] || '';
    if (!targetResume) {
        console.log('  No resume name configured. Skipping named selection.');
    } else {
        const resumeSelected = await page.evaluate((resumeName) => {
            const allEls = Array.from(document.querySelectorAll('label, div, span, h3, a, button'));
            for (const el of allEls) {
                if (el.innerText && el.innerText.includes(resumeName)) {
                    let p = el;
                    for (let up = 0; up < 5; up++) {
                        if (p && (p.tagName === 'LABEL' || p.getAttribute('role') === 'radio' || p.querySelector('input[type="radio"]'))) {
                            p.click();
                            return true;
                        }
                        if (p) p = p.parentElement;
                    }
                    el.click();
                    return true;
                }
            }
            return false;
        }, targetResume);

        if (resumeSelected) {
            console.log(`  Selected named resume: ${targetResume}`);
            return;
        }
    }
};

// ---------------------------------------------------------------------------
// Task 10: Helper — save a screenshot for debugging failed applications
// ---------------------------------------------------------------------------
const screenshotOnFailure = async (page, label) => {
    try {
        const screenshotDir = path.join(__dirname, '..', 'data', 'screenshots');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
        const screenshotPath = path.join(screenshotDir, `fail_${label}_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`  📸 Screenshot saved: ${screenshotPath}`);
    } catch (_) { /* non-fatal */ }
};
// ---------------------------------------------------------------------------
// Helper: targeted recovery from LinkedIn form validation errors.
// Reads error text next to inputs, fixes numeric/type-mismatch errors.
// ---------------------------------------------------------------------------
const recoverLinkedInFormErrors = async (page, answers) => {
    try {
        const errorFields = await page.evaluate(() => {
            const errorEls = Array.from(document.querySelectorAll('.artdeco-inline-feedback--error'))
                .filter(el => el.offsetParent !== null);

            return errorEls.map(errEl => {
                let container = errEl.parentElement;
                for (let i = 0; i < 8; i++) {
                    if (!container) break;
                    const inp = container.querySelector('input[type="text"], input[type="number"], input[type="tel"], textarea');
                    if (inp) {
                        const label = container.querySelector('label, legend, [class*="label"]');
                        return {
                            errorText: errEl.innerText.trim(),
                            labelText: label ? label.innerText.trim() : (inp.placeholder || inp.name || ''),
                            aagroup: container.getAttribute('data-aagroup') || null,
                            inputType: inp.type || 'text',
                            currentValue: inp.value || ''
                        };
                    }
                    container = container.parentElement;
                }
                return null;
            }).filter(Boolean);
        });

        if (errorFields.length === 0) return;
        console.log(`  🔧 LinkedIn error recovery: ${errorFields.length} field(s) to fix`);

        for (const field of errorFields) {
            const isNumericError = /decimal|number|greater than|larger than|digits only|numeric|enter a value/i.test(field.errorText);
            console.log(`    Error: "${field.labelText}" → "${field.errorText}"`);

            let fixValue = null;
            if (isNumericError) {
                const labelLower = field.labelText.toLowerCase();
                if (labelLower.includes('salary') || labelLower.includes('ctc') || labelLower.includes('lpa')) {
                    fixValue = String(answers['current salary'] || answers['expected salary'] || '2');
                } else {
                    fixValue = String(answers['experience'] || '1');
                }
            }

            if (!fixValue || !field.aagroup) continue;

            await page.evaluate(({ aagroup, value }) => {
                const group = document.querySelector(`[data-aagroup="${aagroup}"]`);
                if (!group) return;
                const inp = group.querySelector('input[type="text"], input[type="number"], input[type="tel"], textarea');
                if (!inp) return;
                const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (nativeSet) nativeSet.call(inp, value);
                else inp.value = value;
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
            }, { aagroup: field.aagroup, value: fixValue });

            console.log(`    ✔ Fixed "${field.labelText}" → "${fixValue}"`);
        }
        // await new Promise(r => setTimeout(r, 50));
    } catch (e) {
        console.log('  recoverLinkedInFormErrors error:', e.message);
    }
};


const attemptApply = async (page, jobInfo, attemptNum, answers = {}) => {
    console.log(`  [Attempt ${attemptNum}/2] Opening Easy Apply for: ${jobInfo.title}`);

    const applyBtn = await page.$('.jobs-apply-button');
    if (!applyBtn) {
        console.log('  No Easy Apply button visible in pane.');
        return 'failed';
    }

    await page.evaluate(b => b.click(), applyBtn);

    try {
        await page.waitForSelector('.artdeco-modal', { timeout: 10000 });
    } catch (e) {
        console.log('  Application modal did not open.');
        return 'failed';
    }

    console.log('  Modal opened. Filling form...');
    let applicationSubmitted = false;
    let resumeUploaded = false; // track per-attempt to avoid re-uploading on every step
    let maxSteps = 20;

    while (maxSteps > 0 && !applicationSubmitted) {
        maxSteps--;
        // Wait for any loading spinner to disappear (poll up to ~1s, 10 rapid checks)
        try {
            for (let spinWait = 0; spinWait < 10; spinWait++) {
                const loaderVisible = await page.evaluate(() => {
                    const loader = document.querySelector('.artdeco-loader, [class*="loader"], [class*="spinner"]');
                    return !!(loader && loader.offsetParent !== null);
                });
                if (!loaderVisible) break;
                await new Promise(r => setTimeout(r, 100));
            }
        } catch (e) {
            // ignore
        }

        // A) Handle resume step — only upload once per application attempt
        if (!resumeUploaded) {
            await handleResumeStep(page, answers);
            resumeUploaded = true;
        }

        // B) Fill all form fields — real Puppeteer interactions
        const fillStart = timer();
        const fillResult = await fillFormFields(page, answers);
        if (fillResult === 'SKIP_JOB') {
            await discardModal(page);
            return 'skipped';
        }
        console.log(`  ⏱  Form fill took ${elapsed(fillStart)}`);

        // C) Identify and click the best action button
        const actionButtons = await page.$$('.artdeco-button--primary');
        let clicked = false;
        let btnToClick = null;
        let btnType = '';

        const buttons = [];
        for (const btn of actionButtons) {
            const text = await page.evaluate(el => el.textContent.trim().toLowerCase(), btn);
            buttons.push({ btn, text });
        }

        const submitBtn = buttons.find(b =>
            b.text === 'apply' ||
            b.text === 'submit application' ||
            b.text.includes('submit application')
        );
        const reviewBtn = buttons.find(b => b.text.includes('review'));
        const nextBtn = buttons.find(b => b.text.includes('next') || b.text.includes('continue'));

        if (submitBtn) {
            btnToClick = submitBtn.btn;
            btnType = 'submit';

            console.log('  Reviewing application details (scrolling)...');
            await page.evaluate(() => {
                const modal = document.querySelector('.jobs-easy-apply-modal__content, .artdeco-modal__content');
                if (modal) modal.scrollTo({ top: modal.scrollHeight, behavior: 'smooth' });
            });

            const submitStart = timer();
            console.log('  Submitting application...');
            await btnToClick.click();
            console.log(`  ⏱  Submit click took ${elapsed(submitStart)}`);
            // await new Promise(r => setTimeout(r, 50));
            applicationSubmitted = true;
            clicked = true;

            const dismissBtn = await page.$('button[aria-label="Dismiss"]');
            if (dismissBtn) await dismissBtn.click();

        } else if (reviewBtn) {
            btnToClick = reviewBtn.btn;
            btnType = 'review';
            const reviewStart = timer();
            console.log('  Clicking "Review"...');
            await btnToClick.click();
            clicked = true;
            console.log(`  ⏱  Review click + response took ${elapsed(reviewStart)}`);
            // await new Promise(r => setTimeout(r, 50));

            // ── Task 9: Log error text + attempt targeted re-fill ──
            const reviewErrors = await page.$$('.artdeco-inline-feedback--error');
            if (reviewErrors.length > 0) {
                const msgs = await Promise.all(reviewErrors.map(e => page.evaluate(el => el.innerText.trim(), e)));
                console.log(`  ❌ Validation errors after Review: ${msgs.join(' | ')}`);
                // Step 1: Targeted numeric/type-mismatch recovery
                await recoverLinkedInFormErrors(page, answers);
                // Step 2: Full re-fill pass for any remaining blanks
                await fillFormFields(page, answers);
                // await new Promise(r => setTimeout(r, 50));
                const stillErrors = await page.$$('.artdeco-inline-feedback--error');
                if (stillErrors.length > 0) {
                    await screenshotOnFailure(page, 'review');
                    return 'failed';
                }
            }

        } else if (nextBtn) {
            btnToClick = nextBtn.btn;
            btnType = 'next';
            const nextStart = timer();
            console.log(`  Clicking "${nextBtn.text}"...`);
            await btnToClick.click();
            clicked = true;
            console.log(`  ⏱  Next click + response took ${elapsed(nextStart)}`);
            // await new Promise(r => setTimeout(r, 50));

            // ── Task 9: Log error text + attempt targeted re-fill ──
            const errors = await page.$$('.artdeco-inline-feedback--error');
            if (errors.length > 0) {
                const msgs = await Promise.all(errors.map(e => page.evaluate(el => el.innerText.trim(), e)));
                console.log(`  ❌ Validation errors on step: ${msgs.join(' | ')}`);
                // Step 1: Targeted numeric/type-mismatch recovery
                await recoverLinkedInFormErrors(page, answers);
                // Step 2: Full re-fill pass for any remaining blanks
                await fillFormFields(page, answers);
                // await new Promise(r => setTimeout(r, 50));
                const stillErrors = await page.$$('.artdeco-inline-feedback--error');
                if (stillErrors.length > 0) {
                    await screenshotOnFailure(page, 'next');
                    return 'failed';
                }
            }
        }

        if (!clicked && !applicationSubmitted) {
            console.log('  Could not find Next/Submit button on this step.');
            await screenshotOnFailure(page, 'no-button');
            return 'failed';
        }
    }

    if (!applicationSubmitted) await screenshotOnFailure(page, 'max-steps');
    return applicationSubmitted ? 'submitted' : 'failed';
};

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------
const run = async () => {
    console.log('LinkedIn Agent Initializing...');

    // Load answers fresh from disk at start of each run (picks up edits without restart)
    const presetAnswers = loadAnswers();
    console.log(`Loaded ${Object.keys(presetAnswers).length} answer(s) from answers.json`);

    const userDataDir = path.join(__dirname, '..', 'data', 'puppeteer', 'linkedin_profile');
    const chromePath = process.env.CHROME_PATH
        || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

    const browser = await puppeteer.launch({
        headless: false,
        executablePath: chromePath,
        userDataDir: userDataDir,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });

    // ---------------------------------------------------------------------------
    // safeEvaluate — retries once on stale/detached element errors.
    // Prevents the agent from crashing when a job card gets detached mid-interaction.
    // ---------------------------------------------------------------------------
    const safeEvaluate = async (page, fn, ...args) => {
        try {
            return await page.evaluate(fn, ...args);
        } catch (err) {
            if (err.message && (err.message.includes('detached') || err.message.includes('destroyed') || err.message.includes('Node is detached'))) {
                console.log('  [safeEvaluate] Stale element — retrying in 1s...');
                // await new Promise(r => setTimeout(r, 50));
                try {
                    return await page.evaluate(fn, ...args);
                } catch (_) {
                    return null; // second failure — give up gracefully
                }
            }
            throw err;
        }
    };

    const failedJobs = [];
    const skippedJobs = [];
    let stopped = false;

    const saveAndExit = async () => {
        if (stopped) return;
        stopped = true;
        console.log('Stop signal received. Closing browser...');
        try { await browser.close(); } catch (_) {}
    };
    process.on('SIGINT', saveAndExit);
    process.on('SIGTERM', saveAndExit);

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        console.log('Navigating to LinkedIn Jobs...');
        await page.goto('https://www.linkedin.com/jobs/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('Checking authentication status...');
        try {
            await page.waitForSelector('#global-nav', { timeout: 10000 });
            console.log('Successfully authenticated!');
        } catch (e) {
            console.log("Please log in manually if you haven't. Waiting 60 seconds...");
            await new Promise(r => setTimeout(r, 60000));
        }

        const jobTitleEnv = process.env.FRONTEND_JOB_TITLE || process.env.JOB_TITLE || 'Software Engineer';
        const jobLocationEnv = process.env.FRONTEND_LOCATION || process.env.JOB_LOCATION || process.env.LOCATION || 'Remote';
        const MAX_APPLICATIONS = parseInt(process.env.MAX_APPLICATIONS || '50', 10);

        console.log(`Searching for: ${jobTitleEnv} in ${jobLocationEnv}`);
        console.log('Filters: Easy Apply ON | Experience Level: Entry Level + Associate');

        // f_AL=true  → Easy Apply only
        // f_E=1%2C2  → Experience Level: Entry Level (1) + Associate (2)
        const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(jobTitleEnv)}&location=${encodeURIComponent(jobLocationEnv)}&f_AL=true&f_E=1%2C2`;
        console.log('Navigating to search results...');
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        try {
            let jobsApplied = 0;
            let currentPage = 1;

            while (!stopped) {
                await page.waitForSelector('.job-card-container', { timeout: 10000 });
                console.log(`Job listings loaded for page ${currentPage}.`);

                // Single scroll pass to ensure all cards render (lazy-loaded images etc.)
                if (!stopped) {
                    await page.evaluate(() => {
                        const pane = document.querySelector('.jobs-search-results-list');
                        if (pane) pane.scrollTop += 1200;
                    });
                    await new Promise(r => setTimeout(r, 500));
                }

                const jobs = await page.$$('.job-card-container');
                console.log(`Found ${jobs.length} jobs on page ${currentPage}.`);

                for (let i = 0; i < jobs.length; i++) {
                    if (stopped) break;

                    if (jobsApplied >= MAX_APPLICATIONS) {
                        console.log(`\nReached maximum application limit of ${MAX_APPLICATIONS}. Stopping.`);
                        stopped = true;
                        break;
                    }

                    console.log(`Selecting job ${i + 1} on page ${currentPage}...`);
                    let jobInfo = { title: 'Unknown Job', company: 'Unknown Company', url: 'Unknown URL' };

                    try {
                        const jobsList = await page.$$('.job-card-container');
                        if (!jobsList[i]) continue;

                        await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), jobsList[i]);
                        await new Promise(r => setTimeout(r, 400 + Math.random() * 300));
                        await jobsList[i].click();
                        await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));

                        // Skip if already applied
                        const appliedBadge = await page.$('.artdeco-inline-feedback--success');
                        if (appliedBadge) {
                            const badgeText = await page.evaluate(el => el.innerText, appliedBadge);
                            if (badgeText.includes('Applied')) {
                                console.log('  Already applied — skipping...');
                                continue;
                            }
                        }

                        const fetchedInfo = await page.evaluate(() => {
                            const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title, .t-24');
                            const companyEl = 
                                document.querySelector('.job-details-jobs-unified-top-card__company-name') ||
                                document.querySelector('.jobs-unified-top-card__company-name') ||
                                document.querySelector('.job-details-jobs-unified-top-card__primary-description a') ||
                                document.querySelector('.job-details-jobs-unified-top-card__primary-description');
                            const jdEl = document.querySelector(
                                '#job-details, .jobs-description__content, .jobs-description-content__text, ' +
                                '.job-details-jobs-unified-top-card__job-description, article.jobs-description'
                            );
                            return {
                                title: titleEl ? titleEl.innerText.trim() : 'Unknown Job',
                                company: companyEl ? companyEl.innerText.trim() : 'Unknown Company',
                                url: window.location.href,
                                jobDescription: jdEl ? (jdEl.innerText || jdEl.textContent).trim() : ''
                            };
                        });
                        jobInfo = { ...jobInfo, ...fetchedInfo };

                        console.log(`  Job: "${jobInfo.title}" at ${jobInfo.company}`);



                        // Skip restricted companies
                        const restrictedCompanies = ['ht media', 'ht media labs', 'ht media lbas', 'ht labs', 'ht media group'];
                        const normalizedCompany = jobInfo.company.toLowerCase().trim();
                        if (restrictedCompanies.some(c => normalizedCompany.includes(c))) {
                            console.log(`  Skipping restricted company: ${jobInfo.company}`);
                            continue;
                        }

                        // Retry loop: up to 2 attempts
                        const maxRetries = 2;
                        let result = 'failed';
                        let resumeUploaded = false;

                        for (let attempt = 1; attempt <= maxRetries; attempt++) {
                            if (attempt > 1) {
                                await discardModal(page);
                                await new Promise(r => setTimeout(r, 2000));
                            }

                            if (attempt === 1 && jobInfo.jobDescription && !resumeUploaded) {
                                try {
                                    const resumeStart = timer();
                                    const { generateTailoredResume } = require('../utils/resumeGenerator');
                                    await generateTailoredResume(jobInfo.jobDescription);
                                    console.log(`  ✔ Resume tailored & generated ${elapsed(resumeStart)}`);
                                } catch (err) {
                                    console.log('  ⚠️ Error triggering resume generation:', err.message);
                                }
                            }
                            const applyStart = timer();
                            result = await attemptApply(page, jobInfo, attempt, presetAnswers);
                            if (result === 'submitted') console.log(`  ⏱  Apply attempt took ${elapsed(applyStart)}`);


                            if (result === 'submitted') {
                                jobsApplied++;
                                console.log(`  ✓ Applied! Total so far: ${jobsApplied}`);
                                recordAppliedJob(jobInfo.title, jobInfo.url);
                                break;
                            }

                            if (result === 'skipped') {
                                console.log(`  ⏭️  Job skipped (notice period: Immediate only).`);
                                skippedJobs.push({ title: jobInfo.title, company: jobInfo.company, url: jobInfo.url, reason: 'Immediate-only notice period' });
                                break;
                            }

                            if (attempt < maxRetries) {
                                console.log(`  Retry ${attempt} failed. Trying again...`);
                            }
                        }

                        if (result !== 'submitted' && result !== 'skipped') {
                            console.log(`  ✗ Both attempts failed. Discarding and tracking for manual review.`);
                            await discardModal(page);
                            failedJobs.push({ title: jobInfo.title, company: jobInfo.company, url: jobInfo.url });
                        }

                    } catch (e) {
                        console.log(`  Error processing job ${i + 1}:`, e.message);
                        failedJobs.push({
                            title: jobInfo.title,
                            company: jobInfo.company,
                            url: jobInfo.url || page.url(),
                            reason: 'Exception: ' + e.message
                        });
                        await discardModal(page);
                    }
                }

                if (stopped) break;

                // --- PAGINATE: 3 strategies ---
                console.log(`\nAttempting to go to page ${currentPage + 1}...`);
                let clickedNext = false;

                await page.evaluate(() => {
                    const pagination = document.querySelector('.artdeco-pagination, [data-test-pagination-page-btn]');
                    if (pagination) pagination.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));

                // Strategy 1: numbered page button
                try {
                    const paginationBtns = await page.$$('.artdeco-pagination__indicator--number button, [data-test-pagination-page-btn]');
                    for (const btn of paginationBtns) {
                        const label = await page.evaluate(el =>
                            (el.getAttribute('aria-label') || el.textContent || '').trim(), btn
                        );
                        if (label.includes(`Page ${currentPage + 1}`) || label === String(currentPage + 1)) {
                            await page.evaluate(b => b.click(), btn);
                            clickedNext = true;
                            console.log(`  Strategy 1: clicked page ${currentPage + 1} button.`);
                            break;
                        }
                    }
                } catch (_) {}

                // Strategy 2: Next arrow button
                if (!clickedNext) {
                    try {
                        const nextBtn = await page.evaluateHandle(() => {
                            const candidates = Array.from(document.querySelectorAll('button, li > button'));
                            return candidates.find(el => {
                                const label = (el.getAttribute('aria-label') || '').toLowerCase();
                                const text = (el.textContent || '').toLowerCase().trim();
                                return label.includes('next') || text === 'next' || el.classList.contains('artdeco-pagination__button--next');
                            }) || null;
                        });
                        const el = nextBtn.asElement();
                        if (el) {
                            const isDisabled = await page.evaluate(b => b.disabled || b.getAttribute('aria-disabled') === 'true', el);
                            if (!isDisabled) {
                                await page.evaluate(b => b.click(), el);
                                clickedNext = true;
                                console.log('  Strategy 2: clicked Next arrow button.');
                            }
                        }
                    } catch (_) {}
                }

                // Strategy 3: URL navigation
                if (!clickedNext) {
                    try {
                        const currentUrl = page.url();
                        const nextStart = currentPage * 25;
                        let nextUrl;
                        if (currentUrl.includes('start=')) {
                            nextUrl = currentUrl.replace(/start=\d+/, `start=${nextStart}`);
                        } else {
                            nextUrl = `${currentUrl}&start=${nextStart}`;
                        }
                        console.log(`  Strategy 3: navigating via URL (start=${nextStart}).`);
                        await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        clickedNext = true;
                    } catch (e) {
                        console.log('  Strategy 3 failed:', e.message);
                    }
                }

                if (!clickedNext) {
                    console.log('All pagination strategies exhausted. No more pages.');
                    break;
                }

                currentPage++;
                console.log(`Waiting for page ${currentPage} to load...`);
                try {
                    // Poll until job cards appear (replaces hardcoded 4s wait)
                    await page.waitForSelector('.job-card-container', { timeout: 15000 });
                    // Brief settle for card interactions to be ready
                    await new Promise(r => setTimeout(r, 800));
                    console.log(`Page ${currentPage} loaded.`);
                } catch (e) {
                    console.log(`Timed out waiting for page ${currentPage} cards. Stopping.`);
                    break;
                }
            }

            console.log(`\nFinished. Applied to ${jobsApplied} job(s) total.`);
            if (skippedJobs.length > 0) {
                console.log(`${skippedJobs.length} job(s) skipped (Immediate-only notice period).`);
            }
            if (failedJobs.length > 0) {
                console.log(`${failedJobs.length} job(s) could not be auto-applied — saved for manual review.`);
            }

        } catch (e) {
            console.log('Could not load job listings:', e.message);
        }

        saveFailedJobs(failedJobs);
        console.log('LinkedIn Agent finished tasks.');
    } catch (e) {
        console.error('LinkedIn Agent Error during execution:', e);
        process.exit(1);
    } finally {
        await browser.close();
    }
};

run().catch(err => {
    console.error('LinkedIn Agent Fatal Error:', err);
    process.exit(1);
});
