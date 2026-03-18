console.log('=== Glassdoor Crawler v2.6 - Chunked load→crawl with page cap ===');

// Number of concurrent apply-method detections per batch.
// Increasing this speeds up crawling but may trigger Glassdoor rate-limits.
const BATCH_SIZE = 3;

// Number of "Show more jobs" clicks per load cycle.
// After loading this many pages the crawler processes the new cards before
// loading more.  Keeping this small avoids overwhelming the DOM.
const PAGES_PER_BATCH = 5;

/**
 * Waits for an element matching one of the given selectors to appear in the
 * DOM, retrying up to `maxRetries` times with a delay between checks.
 *
 * @param {string[]} selectors - CSS selectors to look for
 * @param {number} maxRetries - Number of retry attempts (default 3)
 * @param {number} delayMs - Delay between retries in ms (default 800)
 * @returns {Promise<Element|null>}
 */
async function waitForElement(selectors, maxRetries = 3, delayMs = 500) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (_) { /* skip invalid selector */ }
    }
    if (attempt < maxRetries - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

/**
 * Dismisses any overlay / modal popup that Glassdoor might show (login
 * prompts, "Sign up" nudges, etc.). Tries several known close-button
 * selectors.
 */
async function dismissPopups() {
  const closeSelectors = [
    'button[aria-label="Cancel"]',
    'button[aria-label="Close"]',
    '[class*="CloseButton"]',
    'button[class*="closeButton"]',
    'button[class*="modal-close"]',
    '[class*="Modal"] button[aria-label="Close"]',
  ];
  for (const sel of closeSelectors) {
    try {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {   // visible
        btn.click();
        await new Promise(r => setTimeout(r, 300));
        return true;
      }
    } catch (_) { /* skip */ }
  }
  return false;
}

/**
 * Detects the job application method using a three-layer strategy:
 *
 *   Layer 1 — **Text / attribute inspection** (fastest, zero side-effects):
 *       Reads the apply button's text and surrounding DOM to determine the
 *       method.  Glassdoor typically labels buttons "Easy Apply" or
 *       "Apply on employer site" / "Apply Now".
 *
 *   Layer 2 — **DOM class / data-attribute heuristics**:
 *       Checks for Glassdoor-specific class names or data attributes that
 *       hint at Easy Apply vs. external redirect.
 *
 *   Layer 3 — **Click-capture fallback** (last resort):
 *       Clicks the button, captures the URL of the new tab via the
 *       background script, then closes it.  Only used when layers 1–2
 *       are inconclusive.
 *
 * @param {Element} jobCardElement - The job card DOM element
 * @param {number} index - The zero-based index of the job in the list
 * @returns {Promise<string>} "Easy Apply" | "Apply on employer site" | "N/A"
 */
async function detectApplyMethod(jobCardElement, index) {
  // ── Step 1: Click the job card to load the detail panel ──────────────
  const jobLink =
    jobCardElement.querySelector('a[data-test="job-link"]') ||
    jobCardElement.querySelector('a[class*="JobCard_jobTitle"]');

  if (!jobLink) {
    console.warn(`  [${index + 1}] No clickable job link found`);
    return 'N/A';
  }

  jobLink.click();
  await new Promise(r => setTimeout(r, 800));
  await dismissPopups();

  // ── Step 2: Locate the apply button (with retries) ───────────────────
  const applyBtnSelectors = [
    'button[data-test="applyButton"]',
    'a[data-test="applyButton"]',
    'button[class*="ApplyButton"]', 'a[class*="ApplyButton"]',
    'button[class*="applyButton"]', 'a[class*="applyButton"]',
    'button[class*="ApplyNow"]', 'a[class*="ApplyNow"]',
    'button[class*="applyNow"]', 'a[class*="applyNow"]',
    'button[class*="EasyApply"]', 'a[class*="EasyApply"]',
    'button[class*="easyApply"]', 'a[class*="easyApply"]',
  ];

  let applyButton = await waitForElement(applyBtnSelectors, 3, 600);

  // Fallback: any visible button/link in the detail panel whose text
  // contains "Apply" (but NOT inside a job card, to avoid clicking others)
  if (!applyButton) {
    const candidates = document.querySelectorAll(
      'button, a[target="_blank"], a[role="button"]'
    );
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      if (/apply/i.test(text) && !el.closest('[class*="jobCard"]')) {
        applyButton = el;
        break;
      }
    }
  }

  if (!applyButton) {
    console.warn(`  [${index + 1}] Apply button not found in detail panel`);
    return 'N/A';
  }

  // ── Layer 1: Text-based detection ────────────────────────────────────
  const btnText = (applyButton.textContent || '').trim().toLowerCase();
  const parentText = (applyButton.parentElement?.textContent || '').trim().toLowerCase();

  // Glassdoor's "Easy Apply" buttons
  if (/easy\s*apply/i.test(btnText) || /easy\s*apply/i.test(parentText)) {
    console.log(`  [${index + 1}] Detected via text: Easy Apply`);
    return 'Easy Apply';
  }

  // Explicit "Apply on employer site" / "Apply on company site"
  if (/apply\s+on\s+/i.test(btnText) || /employer\s*site|company\s*site/i.test(btnText)) {
    console.log(`  [${index + 1}] Detected via text: Apply on employer site`);
    return 'Apply on employer site';
  }

  // ── Layer 2: DOM attribute / class heuristics ────────────────────────
  const btnClasses = applyButton.className || '';
  const btnDataAttrs = Array.from(applyButton.attributes)
    .map(a => `${a.name}=${a.value}`)
    .join(' ');

  // Glassdoor often uses class names like "EasyApplyButton", "easyApply"
  if (/easy\s*apply/i.test(btnClasses) || /easy\s*apply/i.test(btnDataAttrs)) {
    console.log(`  [${index + 1}] Detected via class/attr: Easy Apply`);
    return 'Easy Apply';
  }

  // <a> tags with target="_blank" that point to external sites
  if (applyButton.tagName === 'A') {
    const href = applyButton.getAttribute('href') || '';
    if (href && !href.includes('glassdoor.com') && !href.startsWith('#') && !href.startsWith('/')) {
      console.log(`  [${index + 1}] Detected via href: Apply on employer site`);
      return 'Apply on employer site';
    }
    // Internal Glassdoor apply links (e.g. /apply/…) → likely Easy Apply
    if (href.includes('/apply/') || href.includes('glassdoor.com/apply')) {
      console.log(`  [${index + 1}] Detected via href: Easy Apply`);
      return 'Easy Apply';
    }
  }

  // Check the detail panel for any "Easy Apply" badge elsewhere
  const detailPanel = document.querySelector(
    '[class*="JobDetails"], [class*="jobDetail"], [data-test="job-details"]'
  );
  if (detailPanel) {
    const panelText = detailPanel.textContent || '';
    if (/easy\s*apply/i.test(panelText)) {
      console.log(`  [${index + 1}] Detected via detail panel text: Easy Apply`);
      return 'Easy Apply';
    }
  }

  // ── Layer 3: Click-capture fallback ──────────────────────────────────
  console.log(`  [${index + 1}] Text/DOM detection inconclusive, trying click-capture…`);
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'captureNewTab' }, (resp) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(resp);
      });
      // Click AFTER the message is sent so background is already listening
      setTimeout(() => applyButton.click(), 300);
    });

    // Dismiss any popup that the click may have opened in-page
    await dismissPopups();

    const url = response?.url || '';
    const error = response?.error || null;

    if (error === 'timeout') {
      // No new tab was opened → the apply happened in-page (Easy Apply modal)
      console.log(`  [${index + 1}] No new tab opened (timeout) → Easy Apply`);
      return 'Easy Apply';
    }

    console.log(`  [${index + 1}] Captured URL: ${url}`);

    if (!url) return 'N/A';

    // Glassdoor internal / Indeed smart-apply URLs → Easy Apply
    if (
      url.includes('smartapply.indeed.com') ||
      url.includes('glassdoor.com/apply') ||
      url.includes('glassdoor.com/job-listing') // sometimes redirects internally
    ) {
      return 'Easy Apply';
    }

    return 'Apply on employer site';
  } catch (err) {
    console.error(`  [${index + 1}] captureNewTab error:`, err);
    return 'N/A';
  }
}

// ---------------------------------------------------------------------------

/**
 * Clicks "Show more jobs" once and waits for new cards to load.
 *
 * @returns {Promise<boolean>} true if the button was found and clicked,
 *                             false if no more jobs to load.
 */
async function clickShowMoreJobs() {
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise(resolve => setTimeout(resolve, 2000));

  const loadMoreButton = document.querySelector(
    'button[data-test="load-more"][data-loading="false"]'
  );
  if (!loadMoreButton) return false;

  console.log('Tìm thấy nút "Show more jobs", đang nhấn...');
  loadMoreButton.click();
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Dismiss any popup that may appear after clicking
  const closePopupButton = document.querySelector(
    'button.icon-button_IconButton__nMTOc[aria-label="Cancel"]'
  );
  if (closePopupButton) {
    console.log('Tìm thấy popup, nhấn nút hủy...');
    closePopupButton.click();
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return true;
}

/**
 * Checks whether the "Show more jobs" button is still present on the page.
 *
 * @returns {boolean}
 */
function hasShowMoreButton() {
  return !!document.querySelector('button[data-test="load-more"]');
}

/**
 * Returns all job card elements currently in the DOM.
 */
function getAllJobCards() {
  return document.querySelectorAll('div[class="JobCard_jobCardContainer__arQlW"]');
}

/**
 * Loads `pages` batches of additional job cards by clicking "Show more jobs"
 * repeatedly.  Returns the total list of job cards in the DOM afterwards.
 *
 * @param {number} pages  - Number of times to click "Show more jobs"
 * @param {number} timeout - Overall timeout in ms
 * @returns {Promise<NodeListOf<Element>>}
 */
async function scrollAndLoadMore(pages, timeout = 180000) {
  console.log(`Bắt đầu crawl ${pages} trang...`);
  const start = Date.now();
  let currentPage = 0;
  let remainingPages = pages;

  const pageLabel = document.getElementById('pageLabel');
  if (pageLabel) pageLabel.textContent = `Còn: ${remainingPages} trang`;

  while (currentPage < pages && Date.now() - start < timeout) {
    const clicked = await clickShowMoreJobs();
    if (!clicked) {
      console.log(
        `Không tìm thấy nút "Show more jobs" ở trang ${currentPage + 1}, ` +
        'có thể đã tải hết hoặc lỗi selector'
      );
      break;
    }

    currentPage++;
    remainingPages--;
    console.log(`Đã cuộn và nhấn "Show more jobs" cho trang ${currentPage}`);
    if (pageLabel) pageLabel.textContent = `Còn: ${remainingPages} trang`;
    if (currentPage === pages) console.log('Đã crawl đủ số trang yêu cầu');
  }

  const jobCards = getAllJobCards();
  if (jobCards.length === 0) {
    throw new Error(
      'Không tìm thấy job card nào sau khi tải. Hãy đảm bảo bạn đang ở ' +
      'trang danh sách việc làm (https://www.glassdoor.com/Job/*) và đã ' +
      'đăng nhập nếu cần.'
    );
  }
  console.log(`Tìm thấy ${jobCards.length} job card sau ${Date.now() - start}ms`);
  return jobCards;
}

function updatePageCountDisplay() {
  console.log('Cập nhật hiển thị số trang...');
  chrome.storage.local.get(['pageCount'], (result) => {
    const pageCount = parseInt(result.pageCount, 10) || 1;
    console.log(`Số trang lấy được từ storage: ${pageCount}`);
    const pageLabel = document.getElementById('pageLabel');
    if (pageLabel) pageLabel.textContent = `Còn: ${pageCount} trang`;
  });
}

function savePageCount() {
  const pageInput = document.getElementById('pageInput');
  const pageCount = parseInt(pageInput.value, 10) || 1;
  console.log(`Đã nhập số trang: ${pageCount}`);
  chrome.storage.local.set({ pageCount: pageCount }, () => {
    console.log(`Đã lưu số trang ${pageCount} vào storage`);
    updatePageCountDisplay();
  });
}

/**
 * Loads the exclude-keywords string from storage and populates the input.
 */
function updateExcludeKeywordsDisplay() {
  chrome.storage.local.get(['excludeKeywords'], (result) => {
    const keywords = result.excludeKeywords || '';
    const input = document.getElementById('excludeKeywordsInput');
    if (input) input.value = keywords;
    const badge = document.getElementById('excludeKeywordsBadge');
    if (badge) {
      const count = keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean).length : 0;
      badge.textContent = count > 0 ? `🚫 ${count} keyword(s)` : 'No filter';
      badge.style.backgroundColor = count > 0 ? '#e53935' : '#757575';
    }
  });
}

/**
 * Saves the comma-separated exclude-keywords string to storage.
 */
function saveExcludeKeywords() {
  const input = document.getElementById('excludeKeywordsInput');
  const raw = input ? input.value : '';
  // Normalise: trim each keyword, drop empties, rejoin
  const cleaned = raw.split(',').map(k => k.trim()).filter(Boolean).join(', ');
  chrome.storage.local.set({ excludeKeywords: cleaned }, () => {
    console.log(`Exclude keywords saved: "${cleaned}"`);
    if (input) input.value = cleaned;
    updateExcludeKeywordsDisplay();
  });
}

/**
 * Returns true if the job should be excluded based on the keyword list.
 * Checks job_title only (case-insensitive).
 */
function shouldExcludeJob(jobData, excludeKeywords) {
  if (!excludeKeywords || excludeKeywords.length === 0) return false;
  const title = (jobData.job_title || '').toLowerCase();
  return excludeKeywords.some(kw => title.includes(kw.toLowerCase()));
}

function initializeCrawler() {
  console.log('Khởi tạo crawler...');
  const crawlContainer = document.createElement('div');
  crawlContainer.className = 'crawl-container';

  const crawlButton = document.createElement('button');
  crawlButton.textContent = 'Crawl Jobs to CSV';
  crawlButton.id = 'crawlButton';
  crawlButton.setAttribute('aria-label', 'Crawl danh sách việc làm');

  const pageInput = document.createElement('input');
  pageInput.id = 'pageInput';
  pageInput.type = 'number';
  pageInput.min = '1';
  pageInput.value = '1';
  pageInput.style.width = '60px';
  pageInput.style.margin = '0 10px';
  pageInput.style.padding = '5px';
  pageInput.style.fontSize = '16px';

  const saveButton = document.createElement('button');
  saveButton.textContent = 'Lưu';
  saveButton.setAttribute('aria-label', 'Lưu số trang');
  saveButton.style.padding = '5px 10px';
  saveButton.style.backgroundColor = '#4CAF50';
  saveButton.style.color = 'white';
  saveButton.style.border = 'none';
  saveButton.style.borderRadius = '4px';
  saveButton.style.cursor = 'pointer';
  saveButton.style.fontSize = '16px';
  saveButton.addEventListener('click', savePageCount);

  const pageLabel = document.createElement('span');
  pageLabel.id = 'pageLabel';
  pageLabel.style.marginLeft = '10px';
  pageLabel.style.color = 'white';
  pageLabel.style.fontSize = '16px';

  // ── Exclude-keywords row ──────────────────────────────────────────────
  const keywordsRow = document.createElement('div');
  keywordsRow.className = 'crawl-keywords-row';

  const keywordsLabel = document.createElement('label');
  keywordsLabel.textContent = 'Exclude keywords:';
  keywordsLabel.setAttribute('for', 'excludeKeywordsInput');
  keywordsLabel.className = 'crawl-keywords-label';

  const keywordsInput = document.createElement('input');
  keywordsInput.id = 'excludeKeywordsInput';
  keywordsInput.type = 'text';
  keywordsInput.placeholder = 'e.g. intern, senior, remote';
  keywordsInput.className = 'crawl-keywords-input';

  const keywordsSaveBtn = document.createElement('button');
  keywordsSaveBtn.textContent = 'Save';
  keywordsSaveBtn.id = 'saveExcludeKeywordsBtn';
  keywordsSaveBtn.className = 'crawl-keywords-save';
  keywordsSaveBtn.setAttribute('aria-label', 'Save exclude keywords');
  keywordsSaveBtn.addEventListener('click', saveExcludeKeywords);

  const keywordsBadge = document.createElement('span');
  keywordsBadge.id = 'excludeKeywordsBadge';
  keywordsBadge.className = 'crawl-keywords-badge';
  keywordsBadge.textContent = 'No filter';

  keywordsRow.appendChild(keywordsLabel);
  keywordsRow.appendChild(keywordsInput);
  keywordsRow.appendChild(keywordsSaveBtn);
  keywordsRow.appendChild(keywordsBadge);

  // ── Assemble the main row (page count controls) ───────────────────────
  const mainRow = document.createElement('div');
  mainRow.className = 'crawl-main-row';
  mainRow.appendChild(crawlButton);
  mainRow.appendChild(pageInput);
  mainRow.appendChild(saveButton);
  mainRow.appendChild(pageLabel);

  crawlContainer.appendChild(mainRow);
  crawlContainer.appendChild(keywordsRow);
  document.body.appendChild(crawlContainer);

  updatePageCountDisplay();
  updateExcludeKeywordsDisplay();

  crawlButton.addEventListener('click', async () => {
    console.log('Nút crawl được nhấn, đang lấy số trang...');
    chrome.storage.local.get(['pageCount', 'excludeKeywords'], async (result) => {
      const maxPages = parseInt(result.pageCount, 10) || 1;
      const firstBatch = Math.min(PAGES_PER_BATCH, maxPages);

      // Parse exclude keywords
      const excludeKeywordsRaw = result.excludeKeywords || '';
      const excludeKeywords = excludeKeywordsRaw
        .split(',')
        .map(k => k.trim())
        .filter(Boolean);
      if (excludeKeywords.length > 0) {
        console.log(`Exclude keywords active: [${excludeKeywords.join(', ')}]`);
      }

      console.log(
        `Đang crawl tối đa ${maxPages} trang ` +
        `(${PAGES_PER_BATCH} trang/batch)...`
      );

      try {
        // ── Initial load ────────────────────────────────────────────────
        const initialCards = await scrollAndLoadMore(firstBatch);
        if (!initialCards.length) {
          console.error('Không tìm thấy job card nào trên trang');
          alert('Không tìm thấy việc làm! Hãy đảm bảo bạn đang ở trang danh sách việc làm.');
          return;
        }

        console.log('Bắt đầu crawl...');
        const jobs = [['Company Name', 'Job Title', 'Link', 'Salary', 'Location', 'Date Posted', 'Apply Method']];
        const seenJobIds = new Set();
        let excludedCount = 0;
        let totalPagesLoaded = firstBatch; // pages loaded so far
        let totalProcessed = 0;

        // ── Create floating progress indicator ──────────────────────────
        const progressEl = document.createElement('div');
        progressEl.id = 'crawlProgress';
        Object.assign(progressEl.style, {
          position: 'fixed', bottom: '60px', right: '20px', zIndex: '100000',
          background: 'rgba(0,0,0,0.85)', color: '#0f0', padding: '8px 14px',
          borderRadius: '8px', fontFamily: 'monospace', fontSize: '13px',
        });
        document.body.appendChild(progressEl);

        const overallStart = Date.now();
        let processedCardCount = 0; // index of the last card we've processed

        // ── Iterative load → crawl loop ─────────────────────────────────
        // We keep going as long as:
        //   1. There are new cards to process, AND
        //   2. The "Show more jobs" button still exists (more jobs available),
        //      OR we haven't processed all the cards loaded so far.
        let continueLoading = true;

        while (continueLoading) {
          // Grab all cards currently in the DOM
          const allCards = getAllJobCards();
          const newCards = Array.from(allCards).slice(processedCardCount);

          if (newCards.length === 0) {
            console.log('Không có job card mới nào để xử lý.');
            break;
          }

          console.log(
            `\n── Batch: processing cards ${processedCardCount + 1}–` +
            `${processedCardCount + newCards.length} ──`
          );

          // ── Phase 1: Fast DOM-only data extraction ────────────────────
          const pendingJobs = [];
          const phase1Start = Date.now();

          for (let i = 0; i < newCards.length; i++) {
            const globalIndex = processedCardCount + i;
            const job = newCards[i];
            try {
              const linkElement = job.querySelector('a[data-test="job-link"]');
              let link_job = linkElement ? linkElement.getAttribute('href') || 'N/A' : 'N/A';
              if (link_job !== 'N/A' && !link_job.startsWith('http')) {
                link_job = `https://www.glassdoor.com${link_job}`;
              }

              const jobIdMatch = link_job.match(/jobListingId=(\d+)/);
              const jobId = jobIdMatch ? jobIdMatch[1] : null;
              if (jobId && seenJobIds.has(jobId)) {
                console.log(`Bỏ qua việc làm trùng lặp ID: ${jobId}`);
                continue;
              }
              if (jobId) seenJobIds.add(jobId);

              const date_post    = job.querySelector('div[class*="JobCard_listingAge__jJsuc"]')?.textContent.trim() || 'N/A';
              const company_name = job.querySelector('span[class*="EmployerProfile_compactEmployerName__9MGcV"]')?.textContent.trim() || 'N/A';
              const location     = job.querySelector('div[class*="JobCard_location__Ds1fM"]')?.textContent.trim() || 'N/A';
              const job_title    = job.querySelector('a[class*="JobCard_jobTitle__GLyJ1"]')?.textContent.trim() || 'N/A';
              const salary       = job.querySelector('div[class*="JobCard_salaryEstimate__QpbTW"]')?.textContent.trim() || 'N/A';

              if ([link_job, company_name, job_title, salary, location, date_post].every(val => val === 'N/A')) {
                console.log(`Việc làm ${globalIndex + 1}: Bỏ qua (tất cả trường N/A)`);
                continue;
              }

              // ── Keyword exclusion check ────────────────────────────────
              const jobData = { company_name, job_title, link_job, salary, location, date_post };
              if (shouldExcludeJob(jobData, excludeKeywords)) {
                excludedCount++;
                console.log(
                  `Việc làm ${globalIndex + 1}: Excluded (keyword match) — ` +
                  `"${job_title}" @ "${company_name}"`
                );
                continue;
              }

              pendingJobs.push({
                element: job,
                index: globalIndex,
                data: jobData,
              });
            } catch (e) {
              console.error(`Lỗi trích xuất việc làm ${globalIndex + 1}: ${e.message}`);
            }
          }
          console.log(
            `Phase 1 done: ${pendingJobs.length} unique jobs extracted ` +
            `(${excludedCount} excluded by keywords) in ` +
            `${Date.now() - phase1Start}ms`
          );

          // ── Phase 2: Batch apply-method detection ─────────────────────
          console.log(`Phase 2: detecting apply method in batches of ${BATCH_SIZE}…`);
          const phase2Start = Date.now();

          for (let batchStart = 0; batchStart < pendingJobs.length; batchStart += BATCH_SIZE) {
            const batch = pendingJobs.slice(batchStart, batchStart + BATCH_SIZE);

            for (const item of batch) {
              totalProcessed++;
              progressEl.textContent =
                `⏳ Detecting apply method: ${totalProcessed} ` +
                `(card ${item.index + 1}) …`;
              try {
                const apply_method = await detectApplyMethod(item.element, item.index);
                const d = item.data;
                console.log(
                  `Việc làm ${item.index + 1}: ${d.company_name} | ` +
                  `${d.job_title} | ${apply_method}`
                );
                jobs.push([
                  d.company_name, d.job_title, d.link_job,
                  d.salary, d.location, d.date_post, apply_method,
                ]);
              } catch (e) {
                console.error(`Lỗi detect apply ${item.index + 1}: ${e.message}`);
                const d = item.data;
                jobs.push([
                  d.company_name, d.job_title, d.link_job,
                  d.salary, d.location, d.date_post, 'N/A',
                ]);
              }
            }
          }

          console.log(
            `Phase 2 done: ${pendingJobs.length} jobs in ` +
            `${Date.now() - phase2Start}ms`
          );

          // Mark these cards as processed
          processedCardCount += newCards.length;

          // ── Check whether to load more ────────────────────────────────
          // Continue if:
          //   - totalPagesLoaded < maxPages (haven't hit the page cap), AND
          //   - the "Show more jobs" button is still present.
          if (totalPagesLoaded >= maxPages) {
            console.log(
              `Đã đạt giới hạn trang: ${totalPagesLoaded}/${maxPages}. ` +
              'Dừng tải thêm.'
            );
            continueLoading = false;
          } else if (hasShowMoreButton()) {
            const remaining = maxPages - totalPagesLoaded;
            const nextBatch = Math.min(PAGES_PER_BATCH, remaining);
            console.log(
              `"Show more jobs" button still present. ` +
              `Pages loaded: ${totalPagesLoaded}/${maxPages}. ` +
              `Loading next batch of ${nextBatch} pages…`
            );

            const pageLabel = document.getElementById('pageLabel');

            // Load the next small batch of pages
            let additionalLoaded = 0;
            for (let p = 0; p < nextBatch; p++) {
              const clicked = await clickShowMoreJobs();
              if (!clicked) {
                console.log('Không còn nút "Show more jobs", dừng tải thêm.');
                continueLoading = false;
                break;
              }
              additionalLoaded++;
              totalPagesLoaded++;
              if (pageLabel) {
                pageLabel.textContent =
                  `Đã tải: ${totalPagesLoaded}/${maxPages} trang`;
              }
            }

            if (additionalLoaded === 0) {
              continueLoading = false;
            }
            // If we loaded more pages, the while-loop will pick up new cards
          } else {
            console.log(
              'Nút "Show more jobs" không còn xuất hiện. ' +
              'Đã tải hết tất cả job cards.'
            );
            continueLoading = false;
          }
        }

        const excludeNote = excludedCount > 0
          ? ` (${excludedCount} excluded by keywords)`
          : '';
        progressEl.textContent =
          `✅ Done! ${totalProcessed} jobs processed${excludeNote} in ` +
          `${((Date.now() - overallStart) / 1000).toFixed(1)}s`;
        setTimeout(() => progressEl.remove(), 5000);
        console.log(
          `Crawl complete: ${totalProcessed} jobs (${excludedCount} excluded), ` +
          `${totalPagesLoaded} pages, ${Date.now() - overallStart}ms`
        );

        // ── Export CSV ──────────────────────────────────────────────────
        try {
          if (jobs.length === 1) {
            console.error('Không tìm thấy việc làm hợp lệ để lưu vào CSV');
            alert('Không tìm thấy việc làm hợp lệ để lưu vào CSV.');
            return;
          }

          console.log('CSV Header:', JSON.stringify(jobs[0]));
          console.log('CSV First row:', JSON.stringify(jobs[1]));
          console.log(`Tổng số cột: ${jobs[0].length}, Tổng số hàng dữ liệu: ${jobs.length - 1}`);

          const validJobCount = jobs.length - 1;
          let fileTitle = document.title.replace(/^\d+(?:_\d+)*_/, '');
          fileTitle = fileTitle.replace(/[\/\\:\*\?"<>\|]/g, '_');
          fileTitle = encodeURIComponent(fileTitle).replace(/%[0-9A-F]{2}/gi, '_');
          const csvContent = jobs.map(row => row.map(cell => {
            if (typeof cell === 'string' && (cell.startsWith('https://') || cell.startsWith('http://'))) {
              return cell;
            }
            return `"${cell.replace(/"/g, '""')}"`;
          }).join(',')).join('\n');

          const BOM = '\uFEFF';
          const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
          const blobUrl = URL.createObjectURL(blob);
          const downloadAnchor = document.createElement('a');
          downloadAnchor.setAttribute('href', blobUrl);
          downloadAnchor.setAttribute('download', `${validJobCount}_${fileTitle}.csv`);
          document.body.appendChild(downloadAnchor);
          downloadAnchor.click();
          downloadAnchor.remove();
          URL.revokeObjectURL(blobUrl);
          alert(`Đã crawl ${validJobCount} việc làm và lưu vào CSV!`);
        } catch (e) {
          console.error(`Lỗi tạo CSV: ${e.message}`);
          alert('Lỗi tạo CSV. Kiểm tra console để biết chi tiết.');
        }
      } catch (err) {
        console.error(`Crawl thất bại: ${err.message}`);
        alert(`Crawl thất bại: ${err.message}`);
      }
    });
  });
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initializeCrawler();
} else {
  document.addEventListener('DOMContentLoaded', initializeCrawler);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updatePageCount') {
    console.log('Nhận được thông điệp updatePageCount từ background');
    updatePageCountDisplay();
    sendResponse({ status: 'updated' });
  }
});