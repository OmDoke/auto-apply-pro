'use strict';

// ---------------------------------------------------------------------------
// Easy Apply modal: step navigation, resume upload, submission confirmation.
// attemptApply returns { status, reason, retryable }
//   status: submitted | unconfirmed | failed | skipped | needs_answer
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { fillFormFields, sleep } = require('./formFields');

// Old layout: .jobs-easy-apply-modal / .artdeco-modal. New layout: <dialog data-testid="dialog">
// with hashed classes, plain <footer> buttons and text progress ("25 percent complete", "1/4 pages").
const MODAL_SELECTOR = '.jobs-easy-apply-modal, .artdeco-modal, dialog[data-testid="dialog"][open]';
const ERROR_SELECTOR =
    '.artdeco-inline-feedback--error, ' +
    'dialog[data-testid="dialog"] [role="alert"], ' +
    'dialog[data-testid="dialog"] [data-testid*="error" i], ' +
    // New layout: "<p>Invalid input</p>" is a direct child of the helper text (the char counter is nested deeper)
    'dialog[data-testid="dialog"] [data-testid$="helper-text"] > p, ' +
    // New layout radio/checkbox groups: "<p>question</p><fieldset/><p>This field is required</p>"
    'dialog[data-testid="dialog"] fieldset ~ p';

const elapsed = (start) => `(${Date.now() - start}ms)`;

// Helpers defined inside every page, so page.evaluate callbacks can share them
const pageHelpers = () => {
    window.__aaModal = () =>
        document.querySelector('.jobs-easy-apply-modal') ||
        document.querySelector('dialog[data-testid="dialog"][open]') ||
        document.querySelector('.artdeco-modal');
    // Signature of the current modal step: progress value + section heading
    window.__aaStepSig = () => {
        const m = window.__aaModal();
        if (!m) return 'closed';
        const progress = m.querySelector('progress, [role="progressbar"]');
        let pv = progress ? (progress.value ?? progress.getAttribute('aria-valuenow') ?? '') : '';
        if (!pv) {
            const t = (m.innerText || '').match(/(\d+)\s*percent complete|(\d+\s*\/\s*\d+)\s*pages/i) || [];
            pv = t[1] || t[2] || '';
        }
        // New layout: h2 is the constant "Apply to <company>"; the section title is the first <p>
        const heading = m.querySelector('h3') || m.querySelector('[data-testid="lazy-column"] p') || m.querySelector('h2');
        return `${pv}|${heading ? heading.innerText.trim() : ''}`;
    };
};

const installPageHelpers = async (page) => {
    await page.evaluateOnNewDocument(pageHelpers);
    await page.evaluate(pageHelpers).catch(() => {});
};

const getModal = async (page) => {
    const handle = await page.evaluateHandle(() => window.__aaModal());
    const el = handle.asElement();
    if (!el) await handle.dispose();
    return el;
};

// Easy Apply button on the job page: old .jobs-apply-button, new button[aria-label="Easy Apply to this job"]
const findEasyApplyButton = async (page, timeout = 5000) => {
    const handle = await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('.jobs-apply-button, button[aria-label*="Easy Apply" i]'))
            .find(b => b.offsetParent !== null && !b.disabled && !b.closest('dialog') &&
                /easy apply/i.test(`${b.getAttribute('aria-label') || ''} ${b.innerText || ''}`)),
    { timeout, polling: 250 }).catch(() => null);
    const el = handle && handle.asElement();
    if (handle && !el) await handle.dispose();
    return el || null;
};

// New layout sometimes renders "No network connection" + Refresh inside the dialog.
// Click Refresh a couple of times; returns false if the form never loads.
const recoverModalNetworkError = async (page) => {
    const hasError = () => page.evaluate(() => {
        const m = window.__aaModal();
        return !!m && /no network connection/i.test(m.innerText || '');
    });
    for (let i = 0; i < 2 && await hasError(); i++) {
        console.log('  ⚠️ Easy Apply modal shows "No network connection" — clicking Refresh...');
        await page.evaluate(() => {
            const btn = Array.from(window.__aaModal().querySelectorAll('button'))
                .find(b => /refresh/i.test(b.innerText || ''));
            if (btn) btn.click();
        });
        await page.waitForFunction(() => {
            const m = window.__aaModal();
            return !m || !/no network connection/i.test(m.innerText || '');
        }, { timeout: 8000, polling: 300 }).catch(() => {});
    }
    return !(await hasError());
};

const screenshotOnFailure = async (page, label) => {
    try {
        fs.mkdirSync(cfg.screenshotDir, { recursive: true });
        const safe = String(label).replace(/[^a-z0-9_-]/gi, '_');
        const screenshotPath = path.join(cfg.screenshotDir, `fail_${safe}_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`  📸 Screenshot saved: ${screenshotPath}`);
        return screenshotPath;
    } catch (_) {
        return null;
    }
};

// Close the Easy Apply modal: Dismiss → wait for the confirm dialog → Discard
const discardModal = async (page) => {
    try {
        const modal = await getModal(page);
        const dismissBtn = (modal && await modal.$('button[aria-label="Dismiss"]')) || await page.$('button[aria-label="Dismiss"]');
        if (!dismissBtn) return;
        await dismissBtn.click();
        await page.waitForFunction(() =>
            Array.from(document.querySelectorAll('button')).some(b => (b.innerText || '').toLowerCase().includes('discard')) ||
            !window.__aaModal(),
        { timeout: 3000 }).catch(() => {});
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button'))
                .find(b => (b.innerText || '').toLowerCase().includes('discard'));
            if (btn) btn.click();
        });
        await page.waitForFunction(() => !window.__aaModal(), { timeout: 3000 }).catch(() => {});
    } catch (_) { /* modal already gone */ }
};

const waitForSpinner = async (page) => {
    try {
        await page.waitForFunction(() => {
            const loader = document.querySelector('.artdeco-loader, [class*="loader"], [class*="spinner"]');
            return !(loader && loader.offsetParent !== null);
        }, { timeout: 3000, polling: 100 });
    } catch (_) { /* continue anyway */ }
};

const stepSignature = (page) => page.evaluate(() => window.__aaStepSig());

// Click Next/Review and wait until the step changes or a validation error shows.
// Returns true if the step advanced.
const clickAndWaitForStep = async (page, btn) => {
    const before = await stepSignature(page);
    await btn.click();
    await page.waitForFunction((prev, errSel) =>
        window.__aaStepSig() !== prev || Array.from(document.querySelectorAll(errSel)).some(el => el.offsetParent !== null && !/success/i.test(el.innerText || '')),
    { timeout: 8000, polling: 150 }, before, ERROR_SELECTOR).catch(() => {});
    await waitForSpinner(page);
    return (await stepSignature(page)) !== before;
};

// New layout reuses the error slot for notices like "Resume uploaded successfully"
const getVisibleErrors = (page) => page.evaluate((sel) =>
    Array.from(document.querySelectorAll(sel))
        .filter(el => el.offsetParent !== null && !/success/i.test(el.innerText || ''))
        .map(el => el.innerText.trim()), ERROR_SELECTOR);

// Primary action buttons inside the Easy Apply modal only
const getActionButtons = async (page) => {
    const modal = await getModal(page);
    if (!modal) return [];
    const handles = await modal.$$('.artdeco-button--primary, footer button');
    const buttons = [];
    for (const btn of handles) {
        const text = await page.evaluate(el => el.textContent.trim().toLowerCase(), btn);
        buttons.push({ btn, text });
    }
    return buttons;
};

// Untick "Follow <company>" on the review step (LinkedIn ticks it by default)
const untickFollowCompany = async (page) => {
    if (cfg.followCompany) return;
    await page.evaluate(() => {
        const m = window.__aaModal();
        // New layout: empty <label for>; the "Follow <company>…" text sits next to the input's wrapper
        const rowText = (c) => {
            for (let p = c, i = 0; p && i < 4 && p.querySelectorAll('input').length <= 1; p = p.parentElement, i++) {
                const t = (p.innerText || '').trim();
                if (t) return t;
            }
            return c.getAttribute('aria-label') || '';
        };
        const cb = document.querySelector('#follow-company-checkbox, input[id*="follow-company"]') ||
            (m && Array.from(m.querySelectorAll('input[type="checkbox"]')).find(c => /^follow\b/i.test(rowText(c))));
        if (cb && cb.checked) {
            const lbl = (cb.labels && cb.labels[0]) || document.querySelector(`label[for="${cb.id}"]`);
            (lbl || cb).click();
        }
    }).catch(() => {});
};

// ---------------------------------------------------------------------------
// Resume step: upload the job's resume into the modal's resume file input.
// Returns true once a resume was uploaded or selected (so later steps skip it).
// ---------------------------------------------------------------------------
const handleResumeStep = async (page, resumePath) => {
    if (fs.existsSync(resumePath)) {
        const scope = await getModal(page) || page;
        const fileInputs = await scope.$$('input[type="file"]');
        for (const input of fileInputs) {
            // Never put the resume into a cover-letter upload
            const isCoverLetter = await page.evaluate(el => {
                const lbl = (el.labels && el.labels[0]) ? el.labels[0].innerText : '';
                const ctx = [el.id, el.name, el.getAttribute('aria-label') || '', lbl].join(' ').toLowerCase();
                return ctx.includes('cover');
            }, input);
            if (isCoverLetter) continue;

            try {
                const uploadStart = Date.now();
                await input.uploadFile(resumePath);
                console.log(`  Resume uploaded: ${path.relative(cfg.dataDir, resumePath)}. Waiting for LinkedIn to process...`);
                await page.waitForFunction(() => {
                    const prog = document.querySelector('[class*="upload"][class*="progress"], [class*="uploading"], .jobs-easy-apply-resume-upload__uploading');
                    return !(prog && prog.offsetParent !== null);
                }, { timeout: 5000, polling: 200 }).catch(() => {});
                console.log(`  ✔ Resume upload processed ${elapsed(uploadStart)}`);
                return true;
            } catch (err) {
                console.log('  Failed to upload resume:', err.message);
            }
        }
        // New layout: no file input in the DOM — the "Upload resume" button opens a native file chooser
        const uploadBtn = await page.evaluateHandle(() => {
            const m = window.__aaModal();
            return m && Array.from(m.querySelectorAll('button')).find(b => /^upload resume$/i.test((b.innerText || '').trim()));
        });
        const uploadEl = uploadBtn.asElement();
        if (!uploadEl) {
            await uploadBtn.dispose();
            // No resume input on this step — try again on the next step
            return false;
        }
        try {
            const uploadStart = Date.now();
            const [chooser] = await Promise.all([
                page.waitForFileChooser({ timeout: 5000 }),
                uploadEl.click(),
            ]);
            await chooser.accept([resumePath]);
            // The uploaded file is added to the list and selected; wait until it shows up checked
            await page.waitForFunction((name) => {
                const m = window.__aaModal();
                return !!m && Array.from(m.querySelectorAll('input[type="radio"]'))
                    .some(r => r.checked && r.getAttribute('aria-label') === name);
            }, { timeout: 15000, polling: 300 }, path.basename(resumePath)).catch(() => {});
            console.log(`  ✔ Resume uploaded via file chooser: ${path.relative(cfg.dataDir, resumePath)} ${elapsed(uploadStart)}`);
            return true;
        } catch (err) {
            console.log('  Failed to upload resume via file chooser:', err.message);
            return false;
        }
    }

    console.log(`  Resume not found at ${resumePath}.`);
    if (!cfg.fallbackResumeName) return false;

    // Fallback: pick a resume already saved on LinkedIn by name
    const selected = await page.evaluate((resumeName) => {
        for (const el of Array.from(document.querySelectorAll('label, div, span, h3, a, button'))) {
            if (el.innerText && el.innerText.includes(resumeName)) {
                let p = el;
                for (let up = 0; up < 5 && p; up++) {
                    if (p.tagName === 'LABEL' || p.getAttribute('role') === 'radio' || p.querySelector('input[type="radio"]')) {
                        p.click();
                        return true;
                    }
                    p = p.parentElement;
                }
                el.click();
                return true;
            }
        }
        return false;
    }, cfg.fallbackResumeName);
    if (selected) console.log(`  Selected named resume: ${cfg.fallbackResumeName}`);
    return selected;
};

// ---------------------------------------------------------------------------
// Targeted fix for numeric/type-mismatch validation errors
// ---------------------------------------------------------------------------
const recoverLinkedInFormErrors = async (page, answers) => {
    try {
        const errorFields = await page.evaluate((errSel) => {
            return Array.from(document.querySelectorAll(errSel))
                .filter(el => el.offsetParent !== null && !/success/i.test(el.innerText || ''))
                .map(errEl => {
                    let container = errEl.parentElement;
                    for (let i = 0; i < 8 && container; i++) {
                        const inp = container.querySelector('input[type="text"], input[type="number"], input[type="tel"], textarea');
                        if (inp) {
                            const label = container.querySelector('label, legend, [class*="label"]');
                            return {
                                errorText: errEl.innerText.trim(),
                                labelText: label ? label.innerText.trim() : (inp.getAttribute('aria-label') || inp.placeholder || inp.name || ''),
                                aagroup: container.getAttribute('data-aagroup') || null,
                            };
                        }
                        container = container.parentElement;
                    }
                    return null;
                }).filter(Boolean);
        }, ERROR_SELECTOR);

        if (errorFields.length === 0) return;
        console.log(`  🔧 LinkedIn error recovery: ${errorFields.length} field(s) to fix`);

        for (const field of errorFields) {
            console.log(`    Error: "${field.labelText}" → "${field.errorText}"`);
            const isNumericError = /decimal|number|greater than|larger than|digits only|numeric|enter a value/i.test(field.errorText);
            if (!isNumericError || !field.aagroup) continue;

            const labelLower = field.labelText.toLowerCase();
            const fixValue = (labelLower.includes('salary') || labelLower.includes('ctc') || labelLower.includes('lpa'))
                ? String(answers['current salary'] || answers['expected salary'] || '2')
                : String(answers['experience'] || '1');

            await page.evaluate(({ aagroup, value }) => {
                const group = document.querySelector(`[data-aagroup="${aagroup}"]`);
                const inp = group && group.querySelector('input[type="text"], input[type="number"], input[type="tel"], textarea');
                if (!inp) return;
                const proto = inp.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                Object.getOwnPropertyDescriptor(proto, 'value').set.call(inp, value);
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
            }, { aagroup: field.aagroup, value: fixValue });

            console.log(`    ✔ Fixed "${field.labelText}" → "${fixValue}"`);
        }
    } catch (e) {
        console.log('  recoverLinkedInFormErrors error:', e.message);
    }
};

// After clicking Submit: wait for LinkedIn's confirmation instead of assuming success
const confirmSubmission = async (page) => {
    await page.waitForFunction((errSel) =>
        /your application was sent|application was sent|application submitted/i.test(document.body.innerText || '') ||
        !window.__aaModal() ||
        Array.from(document.querySelectorAll(errSel)).some(el => el.offsetParent !== null && !/success/i.test(el.innerText || '')),
    { timeout: 12000, polling: 250 }, ERROR_SELECTOR).catch(() => {});

    const errors = await getVisibleErrors(page);
    if (errors.length > 0) return { ok: false, errors };
    const confirmed = await page.evaluate(() =>
        /your application was sent|application was sent|application submitted/i.test(document.body.innerText || '') ||
        !window.__aaModal());
    return { ok: confirmed, errors: [] };
};

// Success popup: old layout has button[aria-label="Dismiss"]; new layout's X / "Done" / "Not now"
// can differ, so try those in order and fall back to Escape
const successPopupOpen = (page) => page.evaluate(() =>
    !!window.__aaModal() || /your application was sent/i.test(
        Array.from(document.querySelectorAll('dialog[open], [role="dialog"]')).map(d => d.innerText || '').join(' ')));

const dismissSuccessModal = async (page) => {
    for (let i = 0; i < 3 && await successPopupOpen(page).catch(() => false); i++) {
        const clicked = await page.evaluate(() => {
            const scopes = [window.__aaModal(), ...document.querySelectorAll('dialog[open], [role="dialog"]')].filter(Boolean);
            const buttons = scopes.flatMap(s => Array.from(s.querySelectorAll('button')));
            const btn = buttons.find(b => /dismiss|close/i.test(b.getAttribute('aria-label') || '')) ||
                buttons.find(b => /^(done|not now|close)$/i.test((b.innerText || '').trim()));
            if (btn) btn.click();
            return !!btn;
        }).catch(() => false);
        if (!clicked) await page.keyboard.press('Escape').catch(() => {});
        await sleep(800);
    }
    const stillOpen = await successPopupOpen(page).catch(() => false);
    console.log(stillOpen ? '  ⚠️ Success popup still open (next navigation will clear it).' : '  ✔ Success popup closed.');
};

// ---------------------------------------------------------------------------
// One attempt at the Easy Apply flow for the currently open job
// ---------------------------------------------------------------------------
const attemptApply = async (page, jobInfo, attemptNum, answers, resumePath) => {
    console.log(`  [Attempt ${attemptNum}/${cfg.maxAttempts}] Opening Easy Apply for: ${jobInfo.title}`);
    const shotLabel = (what) => `${what}_${jobInfo.jobId || 'unknown'}`;

    const applyBtn = await findEasyApplyButton(page);
    if (!applyBtn) return { status: 'failed', reason: 'No Easy Apply button visible', retryable: false };
    await page.evaluate(b => b.click(), applyBtn);

    try {
        await page.waitForSelector(MODAL_SELECTOR, { timeout: 10000 });
    } catch (e) {
        return { status: 'failed', reason: 'Application modal did not open', retryable: true };
    }
    // New layout: the dialog opens with only a spinner (hashed classes) — wait for the form's buttons
    await page.waitForFunction(() => {
        const m = window.__aaModal();
        return !!m && (!!m.querySelector('footer button, .artdeco-button--primary') || /no network connection/i.test(m.innerText || ''));
    }, { timeout: 15000, polling: 250 }).catch(() => {});
    if (!(await recoverModalNetworkError(page))) {
        await screenshotOnFailure(page, shotLabel('network'));
        return { status: 'failed', reason: 'Easy Apply modal showed "No network connection"', retryable: true };
    }

    console.log('  Modal opened. Filling form...');
    const answerCache = new Map(); // shared by every step and validation retry of this attempt
    let resumeUploaded = false;
    let errorRetries = 0;
    let stuckCount = 0;

    for (let step = 1; step <= cfg.maxSteps; step++) {
        await waitForSpinner(page);

        // A) Resume — retried every step until a resume input is actually found
        if (!resumeUploaded) resumeUploaded = await handleResumeStep(page, resumePath);

        // B) Fill fields
        const fillStart = Date.now();
        const fill = await fillFormFields(page, answers, answerCache);
        console.log(`  ⏱  Form fill took ${elapsed(fillStart)}`);
        if (fill.status === 'SKIP_JOB') {
            await discardModal(page);
            return { status: 'skipped', reason: 'Notice period: Immediate only', retryable: false };
        }
        if (fill.status === 'NEEDS_ANSWER') {
            const qs = fill.unanswered.map(q => q.questionText);
            await screenshotOnFailure(page, shotLabel('needs-answer'));
            await discardModal(page);
            return { status: 'needs_answer', reason: `Unanswered required question(s): ${qs.join(' | ')}`, unanswered: fill.unanswered, retryable: false };
        }

        // C) Pick the action button
        const buttons = await getActionButtons(page);
        const submitBtn = buttons.find(b => b.text === 'apply' || b.text.includes('submit'));
        const reviewBtn = buttons.find(b => b.text.includes('review'));
        const nextBtn = buttons.find(b => b.text.includes('next') || b.text.includes('continue'));

        if (submitBtn) {
            await untickFollowCompany(page);
            await page.evaluate(() => {
                const modal = document.querySelector('.jobs-easy-apply-modal__content, .artdeco-modal__content, dialog[open] [data-testid="dialog-content"]');
                if (modal) modal.scrollTo({ top: modal.scrollHeight, behavior: 'smooth' });
            });
            await sleep(800 + Math.random() * 1200); // "read" the review page

            if (cfg.dryRun) {
                const followTicked = await page.evaluate(() => Array.from(window.__aaModal().querySelectorAll('input[type="checkbox"]'))
                    .some(c => c.checked && /follow/i.test(c.parentElement.parentElement.innerText || c.getAttribute('aria-label') || '')));
                console.log(`  🧪 Follow-company checkbox still ticked: ${followTicked}`);
                const shot = await screenshotOnFailure(page, shotLabel('dry-run-review'));
                console.log(`  🧪 DRY RUN: reached "${submitBtn.text}" — discarding instead of submitting.`);
                await discardModal(page);
                return { status: 'skipped', reason: 'Dry run: form completed, not submitted', screenshot: shot, retryable: false };
            }

            const submitStart = Date.now();
            console.log('  Submitting application...');
            jobInfo.submitClicked = true; // caller must never retry after this point
            await submitBtn.btn.click();
            const result = await confirmSubmission(page);
            console.log(`  ⏱  Submit + confirmation took ${elapsed(submitStart)}`);

            if (result.ok) {
                await dismissSuccessModal(page);
                return { status: 'submitted', reason: 'Confirmed by LinkedIn' };
            }
            const shot = await screenshotOnFailure(page, shotLabel('submit'));
            if (result.errors.length > 0) {
                return { status: 'failed', reason: `Validation errors on submit: ${result.errors.join(' | ')}`, screenshot: shot, retryable: false };
            }
            // Submit was clicked but no confirmation — never retry (could double-apply)
            return { status: 'unconfirmed', reason: 'Submit clicked but no confirmation within 12s — verify manually', screenshot: shot, retryable: false };
        }

        const actionBtn = reviewBtn || nextBtn;
        if (actionBtn) {
            const clickStart = Date.now();
            console.log(`  Clicking "${actionBtn.text}"...`);
            const advanced = await clickAndWaitForStep(page, actionBtn.btn);
            console.log(`  ⏱  "${actionBtn.text}" click + response took ${elapsed(clickStart)}`);

            const errors = await getVisibleErrors(page);
            if (errors.length > 0) {
                console.log(`  ❌ Validation errors: ${errors.join(' | ')}`);
                if (errorRetries >= 1) {
                    const shot = await screenshotOnFailure(page, shotLabel('validation'));
                    return { status: 'failed', reason: `Validation errors: ${errors.join(' | ')}`, screenshot: shot, retryable: false };
                }
                errorRetries++;
                await recoverLinkedInFormErrors(page, answers);
                continue; // next iteration re-fills this step and clicks again
            }

            if (advanced) {
                errorRetries = 0;
                stuckCount = 0;
            } else if (++stuckCount >= 2) {
                const shot = await screenshotOnFailure(page, shotLabel('stuck'));
                return { status: 'failed', reason: `Step did not advance after clicking "${actionBtn.text}"`, screenshot: shot, retryable: true };
            }
            continue;
        }

        // No action button — maybe the success modal is already showing
        const isSuccess = await page.evaluate(() => /your application was sent/i.test(document.body.innerText || ''));
        if (isSuccess) {
            console.log('  Success modal detected. Application was submitted successfully.');
            await dismissSuccessModal(page);
            return { status: 'submitted', reason: 'Success modal detected' };
        }
        const shot = await screenshotOnFailure(page, shotLabel('no-button'));
        return { status: 'failed', reason: 'Could not find Next/Review/Submit button', screenshot: shot, retryable: true };
    }

    const shot = await screenshotOnFailure(page, shotLabel('max-steps'));
    return { status: 'failed', reason: `Exceeded ${cfg.maxSteps} steps`, screenshot: shot, retryable: false };
};

module.exports = { attemptApply, discardModal, screenshotOnFailure, findEasyApplyButton, installPageHelpers };
