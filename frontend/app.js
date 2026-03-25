/* ═══════════════════════════════════════════════
   Data Vitrine — Orders Dashboard (JS)
   Server-side pagination + AJAX search
   ═══════════════════════════════════════════════ */

const API_BASE = 'http://localhost:3006/data-vitrine';
const PER_PAGE = 50;

// ─── State ───
let orders = [];   // текущая страница заказов
let totalOrders = 0;
let totalPages = 1;
let currentPage = 1;
let searchQuery = '';

// ─── DOM ───
const $loader = document.getElementById('loader');
const $error = document.getElementById('error');
const $errorText = document.getElementById('errorText');
const $retryBtn = document.getElementById('retryBtn');
const $ordersTable = document.getElementById('ordersTable');
const $ordersBody = document.getElementById('ordersBody');
const $emptyState = document.getElementById('emptyState');
const $pagination = document.getElementById('pagination');
const $prevPage = document.getElementById('prevPage');
const $nextPage = document.getElementById('nextPage');
const $paginationPages = document.getElementById('paginationPages');
const $searchInput = document.getElementById('searchInput');
const $searchClear = document.getElementById('searchClear');
const $statusFilter = document.getElementById('statusFilter');
const $paymentFilter = document.getElementById('paymentFilter');
const $totalCount = document.getElementById('totalCount');
const $filteredCount = document.getElementById('filteredCount');
const $currentPage = document.getElementById('currentPage');
const $modal = document.getElementById('captchaModal');
const $modalOverlay = document.querySelector('#captchaModal .modal__overlay');
const $captchaCheck = document.getElementById('captchaCheck');

// ═══════════════════════════════════════════════
// AJAX — Запрос страницы заказов с сервера
// ═══════════════════════════════════════════════
let fetchController = null; // AbortController для отмены предыдущего запроса

async function fetchPage(page) {
  // Отменяем предыдущий запрос, если ещё летит
  if (fetchController) fetchController.abort();
  fetchController = new AbortController();

  showLoader();
  hideError();
  hideTable(); // Скрываем таблицу (включая столбцы), пока грузятся данные

  // Собираем query-параметры
  const params = new URLSearchParams({
    page: String(page),
    limit: String(PER_PAGE),
  });
  if (searchQuery.trim()) {
    params.set('search', searchQuery.trim());
  }
  if ($statusFilter.value) {
    params.set('status', $statusFilter.value);
  }
  if ($paymentFilter.value) {
    params.set('payment', $paymentFilter.value);
  }

  try {
    const response = await fetch(`${API_BASE}/orders/db?${params}`, {
      signal: fetchController.signal,
    });

    // Ручная проверка 429 HTTP статуса
    if (response.status === 429) {
      const errJson = await response.json();
      if (errJson.error === 'CAPTCHA_REQUIRED') {
        showCaptcha();
        hideLoader();
        return;
      }
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = await response.json();

    orders = json.data;
    totalOrders = json.total;
    totalPages = json.totalPages;
    currentPage = json.page;

    // Обновляем статистику
    $totalCount.textContent = totalOrders;
    $filteredCount.textContent = totalOrders;
    $currentPage.textContent = `${currentPage}/${totalPages}`;

    renderPage();
    renderPagination();
    showTable();
  } catch (err) {
    if (err.name === 'AbortError') return; // отменённый запрос — не ошибка
    showError(`Не удалось загрузить заказы: ${err.message}`);
  } finally {
    hideLoader();
  }
}

// ═══════════════════════════════════════════════
// SEARCH — Поиск с debounce (серверный)
// ═══════════════════════════════════════════════
let searchTimer = null;

function onSearchInput(e) {
  searchQuery = e.target.value;
  $searchClear.classList.toggle('search__clear--visible', searchQuery.length > 0);

  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentPage = 1;
    fetchPage(1);
  }, 350);
}

function clearSearch() {
  $searchInput.value = '';
  searchQuery = '';
  $searchClear.classList.remove('search__clear--visible');
  currentPage = 1;
  fetchPage(1);
  $searchInput.focus();
}

// ═══════════════════════════════════════════════
// RENDER — Отрисовка таблицы
// ═══════════════════════════════════════════════
function renderPage() {
  if (orders.length === 0) {
    $ordersBody.innerHTML = '';
    $emptyState.style.display = 'block';
    $ordersTable.parentElement.style.display = 'none';
    return;
  }

  $emptyState.style.display = 'none';
  $ordersTable.parentElement.style.display = '';

  $ordersBody.innerHTML = orders.map((order, i) => {
    const delay = i * 15;
    return `
      <tr class="orders__row orders__row--body"
          style="animation-delay: ${delay}ms">
        <td class="orders__cell orders__cell--id">#${order.id}</td>
        <td class="orders__cell">${obfuscateString(order.orderDate)}</td>
        <td class="orders__cell orders__cell--customer" title="${escHtml(order.customer?.fullName || '')}">
          ${obfuscateString(order.customer?.fullName || '—')}
          <br><small style="color:var(--color-text-dim)">${obfuscateString(order.customer?.phone || '')}</small>
        </td>
        <td class="orders__cell orders__cell--restaurant" title="${escHtml(order.restaurant?.brandName || '')}">
          ${obfuscateString(order.restaurant?.brandName || '—')}
        </td>
        <td class="orders__cell"><span style="font-family: monospace;">${obfuscateString(order.restaurant?.inn || '—')} / ${obfuscateString(order.restaurant?.kpp || '—')}</span></td>
        <td class="orders__cell" style="max-width: 150px; white-space: normal; line-height: 1.3;">
          ${obfuscateString(order.restaurant?.address || '—')}
        </td>
        <td class="orders__cell">${order.orderItems?.length || 0}</td>
        <td class="orders__cell">${obfuscateString(order.grandTotal ?? '—')}</td>
        <td class="orders__cell">${renderStatus(order.status)}</td>
      </tr>
    `;
  }).join('');
}

// ─── Helpers ───
function renderStatus(status) {
  const map = {
    'Новый': 'new',
    'Готовится': 'cooking',
    'Передан курьеру': 'courier',
    'Доставляется': 'delivering',
    'Доставлен': 'delivered',
    'Отменен': 'cancelled',
  };
  const mod = map[status] || 'new';
  return `<span class="orders__status orders__status--${mod}">
    <span class="orders__status-dot"></span>${escHtml(status || '—')}
  </span>`;
}

function renderRating(review) {
  if (!review) return '<span class="orders__rating orders__rating--none">—</span>';
  const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
  return `<span class="orders__rating">${stars}</span>`;
}

function renderPayment(method) {
  if (!method) return '—';
  const labels = {
    CARD_ONLINE: '💳 Карта',
    CASH: '💵 Нал.',
    APPLE_PAY: ' Apple',
    GOOGLE_PAY: '🤖 Google',
    SBP: '⚡ СБП',
  };
  return `<span class="orders__payment">${labels[method] || method}</span>`;
}

function escHtml(str) {
  if (str == null) return '';
  const s = String(str);
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// Запутывает строку случайными неразрывными пробелами (zero-width space) - защита от парсинга текстов
function obfuscateString(str) {
  if (!str) return '';
  let res = escHtml(String(str));
  let result = '';
  for (let i = 0; i < res.length; i++) {
    result += res[i];
    if (Math.random() < 0.3) {
      result += '&#8203;'; // Вставляет невидимый символ
    }
  }
  return result;
}

// ═══════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════
function renderPagination() {
  if (totalPages <= 1) {
    $pagination.classList.add('pagination--hidden');
    return;
  }
  $pagination.classList.remove('pagination--hidden');

  $prevPage.disabled = currentPage <= 1;
  $nextPage.disabled = currentPage >= totalPages;

  $paginationPages.innerHTML = '';
  const pages = generatePageNumbers(currentPage, totalPages);

  pages.forEach(p => {
    if (p === '…') {
      const el = document.createElement('span');
      el.className = 'pagination__ellipsis';
      el.textContent = '…';
      $paginationPages.appendChild(el);
    } else {
      const btn = document.createElement('button');
      btn.className = 'pagination__page' + (p === currentPage ? ' pagination__page--active' : '');
      btn.textContent = p;
      btn.addEventListener('click', () => goToPage(p));
      $paginationPages.appendChild(btn);
    }
  });
}

function generatePageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = [];
  pages.push(1);
  if (current > 3) pages.push('…');

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push('…');
  pages.push(total);
  return pages;
}

function goToPage(page) {
  if (page < 1 || page > totalPages || page === currentPage) return;
  fetchPage(page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════
// СРЕДСТВА АНТИСКРАПИНГА
// ═══════════════════════════════════════════════
function showCaptcha() {
  $modal.classList.add('modal--open');
  $captchaCheck.checked = false;
  document.body.style.overflow = 'hidden';
}

function hideCaptcha() {
  $modal.classList.remove('modal--open');
  document.body.style.overflow = '';
}

$captchaCheck.addEventListener('change', async (e) => {
  if (e.target.checked) {
    try {
      await fetch(`${API_BASE}/solve-captcha`, { method: 'POST' });
      // Даём 0.5s для "анимации решения"
      setTimeout(() => {
        hideCaptcha();
        fetchPage(currentPage); // Пытаемся заново
      }, 500);
    } catch (err) {
      console.error(err);
    }
  }
});

// ═══════════════════════════════════════════════
// UI Helpers
// ═══════════════════════════════════════════════
function showLoader() { $loader.classList.remove('loader--hidden'); }
function hideLoader() { $loader.classList.add('loader--hidden'); }
function showError(msg) {
  $errorText.textContent = msg;
  $error.style.display = 'flex';
}
function hideError() { $error.style.display = 'none'; }
function showTable() {
  $ordersTable.parentElement.style.display = '';
  $pagination.classList.remove('pagination--hidden');
}
function hideTable() {
  $ordersTable.parentElement.style.display = 'none';
  $pagination.classList.add('pagination--hidden');
  $emptyState.style.display = 'none';
}

// ═══════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════
$searchInput.addEventListener('input', onSearchInput);
$searchClear.addEventListener('click', clearSearch);

$statusFilter.addEventListener('change', () => {
  currentPage = 1;
  fetchPage(1);
});

$paymentFilter.addEventListener('change', () => {
  currentPage = 1;
  fetchPage(1);
});

$prevPage.addEventListener('click', () => {
  if (currentPage > 1) goToPage(currentPage - 1);
});

$nextPage.addEventListener('click', () => {
  if (currentPage < totalPages) goToPage(currentPage + 1);
});

$retryBtn.addEventListener('click', () => fetchPage(currentPage));

// Убрано открытие модалки - по требованиям задачи ее больше нет

// ═══════════════════════════════════════════════
// INIT — загружаем первую страницу
// ═══════════════════════════════════════════════
fetchPage(1);
