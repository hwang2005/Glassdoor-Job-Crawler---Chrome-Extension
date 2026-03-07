console.log('=== Glassdoor Crawler v2.3 - Smart Apply Method detection ===');

/**
 * Waits for an element matching one of the given selectors to appear in the
 * DOM, retrying up to `maxRetries` times with a delay between checks.
 *
 * @param {string[]} selectors - CSS selectors to look for
 * @param {number} maxRetries - Number of retry attempts (default 3)
 * @param {number} delayMs - Delay between retries in ms (default 800)
 * @returns {Promise<Element|null>}
 */
async function waitForElement(selectors, maxRetries = 3, delayMs = 800) {
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
        await new Promise(r => setTimeout(r, 500));
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
  await new Promise(r => setTimeout(r, 1500));
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

  let applyButton = await waitForElement(applyBtnSelectors, 3, 1000);

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

async function scrollAndLoadMore(pages, timeout = 180000) {
  console.log(`Bắt đầu crawl ${pages} trang...`);
  const start = Date.now();
  let currentPage = 0;
  let remainingPages = pages;

  const pageLabel = document.getElementById('pageLabel');
  if (pageLabel) pageLabel.textContent = `Còn: ${remainingPages} trang`;

  while (currentPage < pages && Date.now() - start < timeout) {
    window.scrollTo(0, document.body.scrollHeight);
    console.log(`Đã cuộn xuống cuối trang ${currentPage + 1}`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    const loadMoreButton = document.querySelector('button[data-test="load-more"][data-loading="false"]');
    if (loadMoreButton) {
      console.log(`Tìm thấy nút "Show more jobs" cho trang ${currentPage + 1}, đang nhấn...`);
      loadMoreButton.click();
      await new Promise(resolve => setTimeout(resolve, 1000));

      const closePopupButton = document.querySelector('button.icon-button_IconButton__nMTOc[aria-label="Cancel"]');
      if (closePopupButton) {
        console.log('Tìm thấy popup, nhấn nút hủy...');
        closePopupButton.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } else {
      console.log(`Không tìm thấy nút "Show more jobs" ở trang ${currentPage + 1}, có thể đã tải hết hoặc lỗi selector`);
      break;
    }
    currentPage++;
    remainingPages--;
    if (pageLabel) pageLabel.textContent = `Còn: ${remainingPages} trang`;
    if (currentPage === pages - 1) console.log('Đã crawl đủ số trang yêu cầu');
  }

  const jobCards = document.querySelectorAll('div[class="JobCard_jobCardContainer__arQlW"]');
  if (jobCards.length === 0) {
    throw new Error('Không tìm thấy job card nào sau khi tải. Hãy đảm bảo bạn đang ở trang danh sách việc làm (https://www.glassdoor.com/Job/*) và đã đăng nhập nếu cần.');
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

  crawlContainer.appendChild(crawlButton);
  crawlContainer.appendChild(pageInput);
  crawlContainer.appendChild(saveButton);
  crawlContainer.appendChild(pageLabel);
  document.body.appendChild(crawlContainer);

  updatePageCountDisplay();

  crawlButton.addEventListener('click', async () => {
    console.log('Nút crawl được nhấn, đang lấy số trang...');
    chrome.storage.local.get(['pageCount'], async (result) => {
      const pageCount = parseInt(result.pageCount, 10) || 1;
      console.log(`Đang crawl ${pageCount} trang...`);

      try {
        const jobElements = await scrollAndLoadMore(pageCount);
        console.log('Bắt đầu crawl...');
        const jobs = [['Company Name', 'Job Title', 'Link', 'Salary', 'Location', 'Date Posted', 'Apply Method']];
        const seenJobIds = new Set();

        if (!jobElements.length) {
          console.error('Không tìm thấy job card nào trên trang');
          alert('Không tìm thấy việc làm! Hãy đảm bảo bạn đang ở trang danh sách việc làm.');
          return;
        }

        // Use for...of so we can await detectApplyMethod for each job
        const jobArray = Array.from(jobElements);
        for (let index = 0; index < jobArray.length; index++) {
          const job = jobArray[index];
          let date_post = 'N/A';
          let company_name = 'N/A';
          let location = 'N/A';
          let job_title = 'N/A';
          let salary = 'N/A';
          let link_job = 'N/A';
          let apply_method = 'N/A';

          try {
            const linkElement = job.querySelector('a[data-test="job-link"]');
            link_job = linkElement ? linkElement.getAttribute('href') || 'N/A' : 'N/A';
            if (link_job !== 'N/A' && !link_job.startsWith('http')) {
              link_job = `https://www.glassdoor.com${link_job}`;
              console.log(`Đã thêm tiền tố cho link: ${link_job}`);
            } else if (link_job === 'N/A') {
              console.warn(`Link không tìm thấy cho job ${index + 1}`);
            }

            const jobIdMatch = link_job.match(/jobListingId=(\d+)/);
            const jobId = jobIdMatch ? jobIdMatch[1] : null;
            if (jobId && seenJobIds.has(jobId)) {
              console.log(`Bỏ qua việc làm trùng lặp ID: ${jobId}`);
              continue;
            }
            if (jobId) seenJobIds.add(jobId);

            date_post = job.querySelector('div[class*="JobCard_listingAge__jJsuc"]')?.textContent.trim() || 'N/A';
            company_name = job.querySelector('span[class*="EmployerProfile_compactEmployerName__9MGcV"]')?.textContent.trim() || 'N/A';
            location = job.querySelector('div[class*="JobCard_location__Ds1fM"]')?.textContent.trim() || 'N/A';
            job_title = job.querySelector('a[class*="JobCard_jobTitle__GLyJ1"]')?.textContent.trim() || 'N/A';
            salary = job.querySelector('div[class*="JobCard_salaryEstimate__QpbTW"]')?.textContent.trim() || 'N/A';

            if ([link_job, company_name, job_title, salary, location, date_post].every(val => val === 'N/A')) {
              console.log(`Việc làm ${index + 1}: Bỏ qua (tất cả trường N/A)`);
              continue;
            }

            // Click-based apply method detection
            apply_method = await detectApplyMethod(job, index);

            console.log(`Việc làm ${index + 1}:`);
            console.log(`  Tên công ty: ${company_name}`);
            console.log(`  Địa điểm: ${location}`);
            console.log(`  Tiêu đề: ${job_title}`);
            console.log(`  Lương: ${salary}`);
            console.log(`  Link: ${link_job}`);
            console.log(`  Ngày đăng: ${date_post}`);
            console.log(`  Phương thức ứng tuyển: ${apply_method}`);
            console.log('-'.repeat(50));

            jobs.push([company_name, job_title, link_job, salary, location, date_post, apply_method]);
          } catch (e) {
            console.error(`Lỗi xử lý việc làm ${index + 1}: ${e.message}`);
          }
        }

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