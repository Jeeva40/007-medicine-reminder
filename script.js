/* =============================================================
   Medicine Reminder — Application Logic
   Vanilla ES6+, no external libraries. Binds behavior to the
   static markup/templates in index.html; all visuals live in
   style.css — this file only manages data, state and DOM updates.
   ============================================================= */

(function () {
  'use strict';

  /* -----------------------------------------------------------
     Constants & configuration
     ----------------------------------------------------------- */
  const STORAGE_KEY = 'medicineReminderData';
  const THEME_STORAGE_KEY = 'medicineReminderTheme';
  const ONBOARDING_STORAGE_KEY = 'medicineReminderOnboardingDismissed';
  const STREAK_STORAGE_KEY = 'medicineReminderStreak';
  const WATER_STORAGE_KEY = 'medicineReminderWater';

  const TOAST_DURATION_MS = 3500;
  const WATER_GOAL = 8;
  const WATER_MAX = 12;
  const MEDICINE_TYPES = ['Tablet', 'Capsule', 'Syrup', 'Injection'];
  const PERIOD_ORDER = ['Morning', 'Afternoon', 'Evening', 'Night'];

  const TYPE_ICON = {
    Tablet: 'fa-solid fa-tablets',
    Capsule: 'fa-solid fa-capsules',
    Syrup: 'fa-solid fa-prescription-bottle',
    Injection: 'fa-solid fa-syringe',
  };

  const STATUS_META = {
    upcoming: { label: 'Upcoming', badgeClass: 'status-upcoming', icon: 'fa-regular fa-clock' },
    taken: { label: 'Taken', badgeClass: 'status-taken', icon: 'fa-solid fa-check' },
    missed: { label: 'Missed', badgeClass: 'status-missed', icon: 'fa-solid fa-xmark' },
  };

  const TOAST_META = {
    success: { icon: 'fa-solid fa-circle-check', className: 'toast-success' },
    error: { icon: 'fa-solid fa-circle-xmark', className: 'toast-error' },
    warning: { icon: 'fa-solid fa-triangle-exclamation', className: 'toast-warning' },
    info: { icon: 'fa-solid fa-circle-info', className: 'toast-info' },
  };

  const HEALTH_TIPS = [
    { icon: 'fa-solid fa-clock', text: 'Take medicines at the same time every day to build a consistent habit.' },
    { icon: 'fa-solid fa-glass-water', text: 'Drink a full glass of water with tablets and capsules to help them absorb properly.' },
    { icon: 'fa-solid fa-utensils', text: 'Some medicines work best with food — check your prescription label to be sure.' },
    { icon: 'fa-solid fa-bell', text: 'Enable notifications so you never miss a dose, even when the app is in the background.' },
    { icon: 'fa-solid fa-box-archive', text: 'Store medicines in a cool, dry place away from direct sunlight and children.' },
    { icon: 'fa-solid fa-calendar-check', text: 'Refill prescriptions a few days early so you never run out unexpectedly.' },
  ];

  const DEFAULT_MEDICINES = [
    { id: 'seed-1', name: 'Metformin', type: 'Tablet', dosage: '500 mg', time: '08:00', status: 'upcoming' },
    { id: 'seed-2', name: 'Vitamin D3', type: 'Capsule', dosage: '1000 IU', time: '09:00', status: 'taken' },
    { id: 'seed-3', name: 'Cough Syrup', type: 'Syrup', dosage: '10 ml', time: '14:00', status: 'missed' },
    { id: 'seed-4', name: 'Insulin', type: 'Injection', dosage: '10 units', time: '20:00', status: 'upcoming' },
  ];

  /* -----------------------------------------------------------
     Application state
     ----------------------------------------------------------- */
  let medicines = [];
  let searchTerm = '';
  let activeFilter = 'today';
  let activeSort = 'time';
  let notificationsEnabled = false;
  let audioContext = null;
  let nextReminder = null; // { medicine, targetDate }
  let editingMedicineId = null;
  let detailsMedicineId = null;
  let confirmHandler = null;
  let healthTipIndex = 0;
  let waterState = { date: '', count: 0 };
  const openOverlayStack = [];
  const dom = {};

  /* -----------------------------------------------------------
     Utilities
     ----------------------------------------------------------- */
  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function todayDateStr(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function dateDiffInDays(fromStr, toStr) {
    const from = new Date(`${fromStr}T00:00:00`);
    const to = new Date(`${toStr}T00:00:00`);
    return Math.round((to - from) / 86400000);
  }

  function formatTime12Hour(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours % 12 === 0 ? 12 : hours % 12;
    return `${displayHour}:${pad2(minutes)} ${period}`;
  }

  function formatDurationShort(ms) {
    if (ms == null || ms <= 0) return '–';
    const totalMinutes = Math.floor(ms / 60000);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  }

  function getTimePeriod(timeStr) {
    const hour = Number(timeStr.split(':')[0]);
    if (hour >= 5 && hour < 12) return 'Morning';
    if (hour >= 12 && hour < 17) return 'Afternoon';
    if (hour >= 17 && hour < 21) return 'Evening';
    return 'Night';
  }

  function getNextOccurrence(timeStr, now = new Date()) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target;
  }

  function generateId() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `med-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function debounce(fn, delay) {
    let timerId;
    return (...args) => {
      clearTimeout(timerId);
      timerId = setTimeout(() => fn(...args), delay);
    };
  }

  function cloneTemplate(templateEl) {
    return templateEl.content.firstElementChild.cloneNode(true);
  }

  /* -----------------------------------------------------------
     Theme (dark mode)
     ----------------------------------------------------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (dom.themeToggle) {
      const icon = dom.themeToggle.querySelector('i');
      const isDark = theme === 'dark';
      icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      dom.themeToggle.setAttribute('aria-pressed', String(isDark));
      dom.themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  function initTheme() {
    let theme;
    try {
      theme = localStorage.getItem(THEME_STORAGE_KEY);
    } catch (error) {
      console.error('Unable to read saved theme.', error);
    }
    if (!theme) {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (error) {
      console.error('Unable to save theme preference.', error);
    }
    showToast(next === 'dark' ? 'Dark mode enabled' : 'Light mode enabled', 'info');
  }

  /* -----------------------------------------------------------
     Loading screen
     ----------------------------------------------------------- */
  function hideLoadingScreen() {
    if (!dom.loadingScreen) return;
    dom.loadingScreen.classList.add('is-hidden');
    dom.loadingScreen.setAttribute('aria-hidden', 'true');
    setTimeout(() => dom.loadingScreen.remove(), 600);
  }

  /* -----------------------------------------------------------
     Local storage persistence
     ----------------------------------------------------------- */
  function loadMedicines() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('Stored medicine data is not a list.');
        medicines = parsed;
      } else {
        medicines = DEFAULT_MEDICINES.map((medicine) => ({ ...medicine }));
        saveMedicines();
      }
    } catch (error) {
      console.error('Failed to load medicines from storage, falling back to defaults.', error);
      medicines = DEFAULT_MEDICINES.map((medicine) => ({ ...medicine }));
    }
  }

  function saveMedicines() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(medicines));
    } catch (error) {
      console.error('Failed to save medicines to storage.', error);
      showToast('Could not save changes locally', 'error');
    }
  }

  function loadWaterState() {
    const today = todayDateStr();
    try {
      const raw = localStorage.getItem(WATER_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      waterState = parsed && parsed.date === today ? parsed : { date: today, count: 0 };
    } catch (error) {
      console.error('Failed to load water intake data.', error);
      waterState = { date: today, count: 0 };
    }
  }

  function saveWaterState() {
    try {
      localStorage.setItem(WATER_STORAGE_KEY, JSON.stringify(waterState));
    } catch (error) {
      console.error('Failed to save water intake data.', error);
    }
  }

  function loadStreak() {
    try {
      const raw = localStorage.getItem(STREAK_STORAGE_KEY);
      return raw ? JSON.parse(raw) : { count: 0, lastCompletedDate: null };
    } catch (error) {
      console.error('Failed to load streak data.', error);
      return { count: 0, lastCompletedDate: null };
    }
  }

  function saveStreak(streak) {
    try {
      localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify(streak));
    } catch (error) {
      console.error('Failed to save streak data.', error);
    }
  }

  function persistAndRefresh() {
    saveMedicines();
    renderAll();
  }

  /* -----------------------------------------------------------
     Statistics
     ----------------------------------------------------------- */
  function computeStats() {
    const taken = medicines.filter((m) => m.status === 'taken').length;
    const missed = medicines.filter((m) => m.status === 'missed').length;
    const upcoming = medicines.filter((m) => m.status === 'upcoming').length;
    const total = medicines.length;
    const adherence = total === 0 ? 0 : Math.round((taken / total) * 100);
    return { taken, missed, upcoming, total, adherence };
  }

  function updateStreak(stats) {
    const today = todayDateStr();
    const streak = loadStreak();
    let displayCount = streak.count;

    if (streak.lastCompletedDate && dateDiffInDays(streak.lastCompletedDate, today) > 1) {
      displayCount = 0;
      saveStreak({ count: 0, lastCompletedDate: streak.lastCompletedDate });
    }

    if (stats.total > 0 && stats.adherence === 100 && streak.lastCompletedDate !== today) {
      const gap = streak.lastCompletedDate ? dateDiffInDays(streak.lastCompletedDate, today) : null;
      const newCount = gap === 1 ? streak.count + 1 : 1;
      saveStreak({ count: newCount, lastCompletedDate: today });
      displayCount = newCount;
    }

    return displayCount;
  }

  function animateNumber(targetEl, toValue, suffix = '') {
    if (!targetEl) return;
    const fromValue = parseInt(targetEl.textContent, 10) || 0;
    const duration = 600;
    const startTime = performance.now();

    function tick(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(fromValue + (toValue - fromValue) * eased);
      targetEl.textContent = `${current}${suffix}`;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function animateCircularProgress(toPercent) {
    if (!dom.circularProgress) return;
    const fromPercent = parseInt(dom.circularProgressValue.textContent, 10) || 0;
    const duration = 700;
    const startTime = performance.now();

    function tick(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(fromPercent + (toPercent - fromPercent) * eased);
      dom.circularProgress.style.setProperty('--progress', `${current}%`);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    dom.circularProgress.setAttribute('aria-label', `Weekly adherence: ${toPercent} percent`);
  }

  function renderSummary(stats) {
    animateNumber(dom.summaryTakenValue, stats.taken);
    animateNumber(dom.summaryUpcomingValue, stats.upcoming);
    animateNumber(dom.summaryMissedValue, stats.missed);

    if (dom.summaryMessage) {
      if (stats.total === 0) {
        dom.summaryMessage.textContent = 'Add a medicine to see your daily summary.';
      } else if (stats.upcoming === 0) {
        dom.summaryMessage.textContent = stats.missed === 0
          ? 'Great job! All of today’s medicines are taken.'
          : `You've completed today's plan with ${stats.missed} missed dose${stats.missed === 1 ? '' : 's'}.`;
      } else {
        dom.summaryMessage.textContent = `${stats.upcoming} medicine${stats.upcoming === 1 ? '' : 's'} still upcoming today.`;
      }
    }
  }

  function renderQuickStats(stats) {
    animateNumber(dom.statTotalValue, stats.total);
    animateNumber(dom.statStreakValue, updateStreak(stats));
    animateNumber(dom.statAdherenceValue, stats.adherence, '%');
    if (dom.statNextdoseValue) {
      dom.statNextdoseValue.textContent = nextReminder
        ? formatDurationShort(nextReminder.targetDate - new Date())
        : '–';
    }
  }

  function renderProgress(stats) {
    animateNumber(dom.progressTakenValue, stats.taken);
    animateNumber(dom.progressMissedValue, stats.missed);
    animateNumber(dom.progressAdherenceValue, stats.adherence, '%');
    animateNumber(dom.circularProgressValue, stats.adherence, '%');
    animateCircularProgress(stats.adherence);
  }

  /* -----------------------------------------------------------
     Onboarding
     ----------------------------------------------------------- */
  function isOnboardingDismissed() {
    try {
      return localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
    } catch (error) {
      return false;
    }
  }

  function dismissOnboarding() {
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    } catch (error) {
      console.error('Unable to save onboarding preference.', error);
    }
    if (dom.onboardingCard) dom.onboardingCard.hidden = true;
  }

  function evaluateOnboardingVisibility() {
    if (!dom.onboardingCard) return;
    const shouldShow = medicines.length === 0 && !isOnboardingDismissed();
    dom.onboardingCard.hidden = !shouldShow;
  }

  /* -----------------------------------------------------------
     Medicine list: filter, search, sort, render (FLIP "move
     card" animation between renders)
     ----------------------------------------------------------- */
  function getFilteredSortedMedicines() {
    let list = [...medicines];

    if (searchTerm) {
      list = list.filter((m) =>
        m.name.toLowerCase().includes(searchTerm) || m.type.toLowerCase().includes(searchTerm)
      );
    }

    switch (activeFilter) {
      case 'taken':
        list = list.filter((m) => m.status === 'taken');
        break;
      case 'missed':
        list = list.filter((m) => m.status === 'missed');
        break;
      case 'upcoming':
        list = list.filter((m) => m.status === 'upcoming');
        break;
      default:
        break; // today / tomorrow: no status filtering
    }

    if (activeSort === 'period') {
      list.sort((a, b) => {
        const periodDiff = PERIOD_ORDER.indexOf(getTimePeriod(a.time)) - PERIOD_ORDER.indexOf(getTimePeriod(b.time));
        return periodDiff !== 0 ? periodDiff : a.time.localeCompare(b.time);
      });
    } else {
      list.sort((a, b) => a.time.localeCompare(b.time));
    }

    return list;
  }

  function buildMedicineCard(medicine, { interactive = true, displayStatus = null } = {}) {
    const status = displayStatus || medicine.status;
    const meta = STATUS_META[status] || STATUS_META.upcoming;
    const card = cloneTemplate(dom.medicineCardTemplate);

    card.id = `medicine-item-${medicine.id}`;
    card.dataset.medicineId = medicine.id;

    card.querySelector('.medicine-type-icon i').className = TYPE_ICON[medicine.type] || 'fa-solid fa-pills';
    card.querySelector('.medicine-name').textContent = medicine.name;
    card.querySelector('.medicine-type').textContent = medicine.type;

    const badge = card.querySelector('.status-badge');
    badge.className = `status-badge ${meta.badgeClass}`;
    badge.querySelector('i').className = meta.icon;
    badge.querySelector('.status-badge-label').textContent = ` ${meta.label}`;

    card.querySelector('.detail-dosage').textContent = medicine.dosage;
    const timeTag = card.querySelector('.detail-time');
    timeTag.setAttribute('datetime', medicine.time);
    timeTag.textContent = formatTime12Hour(medicine.time);

    const takenBtn = card.querySelector('.btn-mark-taken');
    const skipBtn = card.querySelector('.btn-skip');
    const detailsBtn = card.querySelector('.btn-view-details');

    takenBtn.addEventListener('click', () => markAsTaken(medicine.id));
    skipBtn.addEventListener('click', () => skipMedicine(medicine.id));
    detailsBtn.addEventListener('click', () => viewDetails(medicine.id));
    detailsBtn.setAttribute('aria-label', `View details for ${medicine.name}`);

    if (!interactive || status !== 'upcoming') {
      takenBtn.disabled = true;
      skipBtn.disabled = true;
    }

    return card;
  }

  function buildEmptyState(title, subtitle) {
    const emptyState = cloneTemplate(dom.emptyStateTemplate);
    emptyState.querySelector('.empty-state-title').textContent = title;
    emptyState.querySelector('.empty-state-subtitle').textContent = subtitle;
    return emptyState;
  }

  function renderMedicineList() {
    const listEl = dom.medicineList;
    if (!listEl) return;

    const previousRects = new Map();
    Array.from(listEl.children).forEach((child) => {
      const id = child.dataset && child.dataset.medicineId;
      if (id) previousRects.set(id, child.getBoundingClientRect());
    });

    const items = getFilteredSortedMedicines();
    const isTomorrowPreview = activeFilter === 'tomorrow';

    listEl.textContent = '';
    if (items.length === 0) {
      const message = medicines.length === 0
        ? buildEmptyState('No medicines yet', 'Add a medicine to start building your reminder schedule.')
        : buildEmptyState('No matches found', 'Try a different search term or filter.');
      listEl.appendChild(message);
      return;
    }

    items.forEach((medicine) => {
      listEl.appendChild(buildMedicineCard(medicine, {
        interactive: !isTomorrowPreview,
        displayStatus: isTomorrowPreview ? 'upcoming' : null,
      }));
    });

    Array.from(listEl.children).forEach((child) => {
      const id = child.dataset && child.dataset.medicineId;
      if (!id) return;
      const newRect = child.getBoundingClientRect();
      const oldRect = previousRects.get(id);
      if (oldRect) {
        const deltaX = oldRect.left - newRect.left;
        const deltaY = oldRect.top - newRect.top;
        if (deltaX || deltaY) {
          child.animate(
            [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: 'translate(0, 0)' }],
            { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
          );
        }
      } else {
        child.animate(
          [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 320, easing: 'ease-out' }
        );
      }
    });
  }

  /* -----------------------------------------------------------
     Reminder timeline (full-day chronological view)
     ----------------------------------------------------------- */
  function renderTimeline() {
    const listEl = dom.timelineList;
    if (!listEl) return;
    listEl.textContent = '';

    if (medicines.length === 0) {
      listEl.appendChild(buildEmptyState('Nothing scheduled', 'Your reminder timeline will appear here.'));
      return;
    }

    const sorted = [...medicines].sort((a, b) => a.time.localeCompare(b.time));
    sorted.forEach((medicine) => {
      const item = cloneTemplate(dom.timelineItemTemplate);
      const meta = STATUS_META[medicine.status];
      item.dataset.status = medicine.status;

      const timeTag = item.querySelector('.timeline-time');
      timeTag.setAttribute('datetime', medicine.time);
      timeTag.textContent = formatTime12Hour(medicine.time);

      item.querySelector('.timeline-name').textContent = `${medicine.name} (${medicine.dosage})`;

      const badge = item.querySelector('.timeline-status');
      badge.classList.add(meta.badgeClass);
      badge.querySelector('i').className = meta.icon;
      badge.querySelector('.status-badge-label').textContent = ` ${meta.label}`;

      listEl.appendChild(item);
    });
  }

  /* -----------------------------------------------------------
     Success animation for status changes
     ----------------------------------------------------------- */
  function playStatusChangeAnimation(cardId, glowColorVar) {
    const cardEl = document.getElementById(`medicine-item-${cardId}`);
    if (!cardEl) return Promise.resolve();
    const animation = cardEl.animate(
      [
        { transform: 'scale(1)', boxShadow: 'var(--shadow-sm)' },
        { transform: 'scale(1.02)', boxShadow: `0 0 0 5px ${glowColorVar}` },
        { transform: 'scale(1)', boxShadow: 'var(--shadow-sm)' },
      ],
      { duration: 480, easing: 'ease-in-out' }
    );
    return animation.finished.catch(() => {});
  }

  function attachButtonPressAnimation() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('.btn, .fab, .icon-button, .btn-icon, .filter-chip');
      if (!button) return;
      button.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(0.93)' }, { transform: 'scale(1)' }],
        { duration: 220, easing: 'ease-out' }
      );
    });
  }

  /* -----------------------------------------------------------
     Medicine actions
     ----------------------------------------------------------- */
  function markAsTaken(id) {
    const medicine = medicines.find((m) => m.id === id);
    if (!medicine || medicine.status === 'taken') return;

    playStatusChangeAnimation(id, 'var(--color-taken-bg)').then(() => {
      medicine.status = 'taken';
      persistAndRefresh();
      showToast('Medicine Updated', 'success');
    });
  }

  function skipMedicine(id) {
    const medicine = medicines.find((m) => m.id === id);
    if (!medicine || medicine.status !== 'upcoming') return;

    showConfirm({
      title: 'Skip this medicine?',
      message: `Are you sure you want to skip ${medicine.name}? It will be marked as missed.`,
      confirmLabel: 'Skip It',
      onConfirm: () => {
        playStatusChangeAnimation(id, 'var(--color-missed-bg)').then(() => {
          medicine.status = 'missed';
          persistAndRefresh();
          showToast('Medicine Updated', 'warning');
        });
      },
    });
  }

  function deleteMedicine(id) {
    const medicine = medicines.find((m) => m.id === id);
    if (!medicine) return;

    showConfirm({
      title: 'Delete medicine?',
      message: `This will permanently remove ${medicine.name} from your list.`,
      confirmLabel: 'Delete',
      onConfirm: () => {
        medicines = medicines.filter((m) => m.id !== id);
        persistAndRefresh();
        showToast('Medicine Deleted', 'error');
        closeModal(dom.detailsModalOverlay);
      },
    });
  }

  function viewDetails(id) {
    const medicine = medicines.find((m) => m.id === id);
    if (!medicine) return;
    detailsMedicineId = id;

    const meta = STATUS_META[medicine.status];
    dom.detailsName.textContent = medicine.name;
    dom.detailsType.textContent = medicine.type;
    dom.detailsDosage.textContent = medicine.dosage;
    dom.detailsTime.textContent = formatTime12Hour(medicine.time);
    dom.detailsStatusBadge.className = `status-badge ${meta.badgeClass}`;
    dom.detailsStatusBadge.innerHTML = '';
    dom.detailsStatusBadge.appendChild(Object.assign(document.createElement('i'), { className: meta.icon, ariaHidden: 'true' }));
    dom.detailsStatusBadge.appendChild(document.createTextNode(` ${meta.label}`));

    openModal(dom.detailsModalOverlay);
  }

  /* -----------------------------------------------------------
     Next reminder & countdown timer
     ----------------------------------------------------------- */
  function findNextReminder() {
    const upcomingList = medicines.filter((m) => m.status === 'upcoming');
    if (upcomingList.length === 0) return null;

    const now = new Date();
    let best = null;
    let bestTime = null;
    upcomingList.forEach((medicine) => {
      const occurrence = getNextOccurrence(medicine.time, now);
      if (!bestTime || occurrence < bestTime) {
        bestTime = occurrence;
        best = medicine;
      }
    });
    return { medicine: best, targetDate: bestTime };
  }

  function setNextMedicineTimeDisplay(timeStr) {
    dom.nextMedicineTime.textContent = '';
    dom.nextMedicineTime.appendChild(document.createTextNode('Scheduled for '));
    const timeTag = document.createElement('time');
    timeTag.setAttribute('datetime', timeStr);
    timeTag.textContent = formatTime12Hour(timeStr);
    dom.nextMedicineTime.appendChild(timeTag);
  }

  function refreshNextReminder() {
    nextReminder = findNextReminder();
    if (!nextReminder) {
      dom.nextMedicineName.textContent = 'No upcoming reminders';
      dom.nextMedicineTime.textContent = 'All caught up for today';
      dom.countdownValues.forEach((valueEl) => { valueEl.textContent = '--'; });
      return;
    }
    dom.nextMedicineName.textContent = `${nextReminder.medicine.name} — ${nextReminder.medicine.dosage} ${nextReminder.medicine.type}`;
    setNextMedicineTimeDisplay(nextReminder.medicine.time);
  }

  function tickCountdown() {
    if (!nextReminder) return;
    const now = new Date();
    const diffMs = nextReminder.targetDate - now;

    if (diffMs <= 0) {
      triggerReminder(nextReminder.medicine);
      refreshNextReminder();
      renderQuickStats(computeStats());
      return;
    }

    const totalSeconds = Math.floor(diffMs / 1000);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const [hrsEl, minsEl, secsEl] = dom.countdownValues;
    if (hrsEl) hrsEl.textContent = pad2(hrs);
    if (minsEl) minsEl.textContent = pad2(mins);
    if (secsEl) secsEl.textContent = pad2(secs);

    if (dom.statNextdoseValue) dom.statNextdoseValue.textContent = formatDurationShort(diffMs);
  }

  function startCountdownTimer() {
    tickCountdown();
    setInterval(tickCountdown, 1000);
  }

  /* -----------------------------------------------------------
     Reminder popup, browser notifications & sound alert
     ----------------------------------------------------------- */
  function triggerReminder(medicine) {
    showToast(`Reminder Started: ${medicine.name}`, 'info');
    playAlertSound();
    sendBrowserNotification('Time for your medicine', `${medicine.name} — ${medicine.dosage} (${medicine.type})`);
    showReminderPopup(medicine);
  }

  function showReminderPopup(medicine) {
    dom.reminderMessage.textContent = `It's time to take ${medicine.name} (${medicine.dosage}, ${medicine.type}).`;

    const onTaken = () => {
      markAsTaken(medicine.id);
      showToast('Reminder Completed', 'success');
      closeModal(dom.reminderModalOverlay);
      cleanup();
    };
    const onDismiss = () => {
      closeModal(dom.reminderModalOverlay);
      cleanup();
    };
    function cleanup() {
      dom.reminderTakenBtn.removeEventListener('click', onTaken);
      dom.reminderDismissBtn.removeEventListener('click', onDismiss);
    }

    dom.reminderTakenBtn.addEventListener('click', onTaken);
    dom.reminderDismissBtn.addEventListener('click', onDismiss);
    openModal(dom.reminderModalOverlay);
  }

  function updateNotificationIndicator() {
    if (dom.notificationDot) dom.notificationDot.hidden = !notificationsEnabled;
    if (dom.notificationToggle) dom.notificationToggle.setAttribute('aria-pressed', String(notificationsEnabled));
  }

  function requestNotificationPermission() {
    if (!('Notification' in window)) {
      showToast('Browser notifications are not supported here', 'warning');
      return;
    }
    if (Notification.permission === 'granted') {
      notificationsEnabled = !notificationsEnabled;
      updateNotificationIndicator();
      showToast(notificationsEnabled ? 'Notifications enabled' : 'Notifications muted', notificationsEnabled ? 'success' : 'info');
      return;
    }
    Notification.requestPermission()
      .then((permission) => {
        notificationsEnabled = permission === 'granted';
        updateNotificationIndicator();
        showToast(notificationsEnabled ? 'Notifications enabled' : 'Notifications blocked', notificationsEnabled ? 'success' : 'warning');
      })
      .catch((error) => console.error('Notification permission request failed.', error));
  }

  function sendBrowserNotification(title, body) {
    try {
      if (notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    } catch (error) {
      console.error('Unable to send browser notification.', error);
    }
  }

  function ensureAudioContext() {
    if (!audioContext) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContextClass();
      } catch (error) {
        console.error('Web Audio API is not available.', error);
      }
    }
    return audioContext;
  }

  function playAlertSound() {
    try {
      const ctx = ensureAudioContext();
      if (!ctx) return;
      [0, 0.22].forEach((delay) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, ctx.currentTime + delay);
        gainNode.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
        gainNode.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + delay + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.3);
        oscillator.connect(gainNode).connect(ctx.destination);
        oscillator.start(ctx.currentTime + delay);
        oscillator.stop(ctx.currentTime + delay + 0.3);
      });
    } catch (error) {
      console.error('Unable to play alert sound.', error);
    }
  }

  /* -----------------------------------------------------------
     Toast notifications
     ----------------------------------------------------------- */
  function showToast(message, type = 'info') {
    const meta = TOAST_META[type] || TOAST_META.info;
    const toast = cloneTemplate(dom.toastTemplate);
    toast.classList.add(meta.className);
    toast.querySelector('.toast-icon').className = `toast-icon ${meta.icon}`;
    toast.querySelector('.toast-message').textContent = message;

    dom.toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));

    setTimeout(() => {
      toast.classList.remove('is-visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, TOAST_DURATION_MS);
  }

  /* -----------------------------------------------------------
     Generic modal open/close (CSS-driven transitions)
     ----------------------------------------------------------- */
  function openModal(overlay) {
    if (!overlay) return;
    overlay.hidden = false;
    void overlay.offsetWidth; // force reflow so the transition plays
    overlay.classList.add('is-open');
    openOverlayStack.push(overlay);
  }

  function closeModal(overlay) {
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove('is-open');
    const onEnd = (event) => {
      if (event.target !== overlay) return;
      overlay.hidden = true;
      overlay.removeEventListener('transitionend', onEnd);
    };
    overlay.addEventListener('transitionend', onEnd);
    const index = openOverlayStack.indexOf(overlay);
    if (index !== -1) openOverlayStack.splice(index, 1);
  }

  function showConfirm({ title, message, confirmLabel = 'Confirm', onConfirm }) {
    dom.confirmTitle.textContent = title;
    dom.confirmMessage.textContent = message;
    dom.confirmConfirmBtn.textContent = confirmLabel;
    confirmHandler = onConfirm;
    openModal(dom.confirmModalOverlay);
  }

  function wireModalDismissals() {
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeModal(overlay);
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && openOverlayStack.length > 0) {
        closeModal(openOverlayStack[openOverlayStack.length - 1]);
      }
    });
  }

  /* -----------------------------------------------------------
     Add / edit medicine form
     ----------------------------------------------------------- */
  function setFieldError(errorEl, message) {
    if (errorEl) errorEl.textContent = message || '';
  }

  function openMedicineForm(existingMedicine = null) {
    editingMedicineId = existingMedicine ? existingMedicine.id : null;
    const isEdit = Boolean(existingMedicine);

    dom.medicineModalTitle.textContent = isEdit ? 'Edit Medicine' : 'Add New Medicine';
    dom.medicineFormSubmit.querySelector('span').textContent = isEdit ? 'Save Changes' : 'Add Medicine';

    dom.medicineNameInput.value = isEdit ? existingMedicine.name : '';
    dom.medicineTypeSelect.value = isEdit ? existingMedicine.type : MEDICINE_TYPES[0];
    dom.medicineDosageInput.value = isEdit ? existingMedicine.dosage : '';
    dom.medicineTimeInput.value = isEdit ? existingMedicine.time : '';

    [dom.medicineNameError, dom.medicineTypeError, dom.medicineDosageError, dom.medicineTimeError].forEach((el) => setFieldError(el, ''));

    openModal(dom.medicineModalOverlay);
    dom.medicineNameInput.focus();
  }

  function handleMedicineFormSubmit(event) {
    event.preventDefault();

    const name = dom.medicineNameInput.value.trim();
    const dosage = dom.medicineDosageInput.value.trim();
    const time = dom.medicineTimeInput.value.trim();
    const type = dom.medicineTypeSelect.value;
    let hasError = false;

    setFieldError(dom.medicineNameError, '');
    setFieldError(dom.medicineDosageError, '');
    setFieldError(dom.medicineTimeError, '');
    setFieldError(dom.medicineTypeError, '');

    if (name.length < 2) { setFieldError(dom.medicineNameError, 'Please enter a valid name (2+ characters).'); hasError = true; }
    if (!dosage) { setFieldError(dom.medicineDosageError, 'Dosage is required.'); hasError = true; }
    if (!/^\d{2}:\d{2}$/.test(time)) { setFieldError(dom.medicineTimeError, 'Please choose a valid time.'); hasError = true; }
    if (!MEDICINE_TYPES.includes(type)) { setFieldError(dom.medicineTypeError, 'Please choose a medicine type.'); hasError = true; }

    if (hasError) {
      const panel = dom.medicineModalOverlay.querySelector('.modal-panel');
      panel.classList.add('is-shaking');
      panel.addEventListener('animationend', () => panel.classList.remove('is-shaking'), { once: true });
      return;
    }

    if (editingMedicineId) {
      const medicine = medicines.find((m) => m.id === editingMedicineId);
      Object.assign(medicine, { name, dosage, time, type });
      showToast('Medicine Updated', 'success');
    } else {
      medicines.push({ id: generateId(), name, dosage, time, type, status: 'upcoming' });
      showToast('Medicine Added', 'success');
    }

    persistAndRefresh();
    closeModal(dom.medicineModalOverlay);
  }

  /* -----------------------------------------------------------
     Health tip card
     ----------------------------------------------------------- */
  function renderHealthTip() {
    const tip = HEALTH_TIPS[healthTipIndex];
    dom.healthTipIcon.querySelector('i').className = tip.icon;
    dom.healthTipText.textContent = tip.text;
  }

  function showNextHealthTip() {
    healthTipIndex = (healthTipIndex + 1) % HEALTH_TIPS.length;
    dom.healthTipText.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    renderHealthTip();
  }

  /* -----------------------------------------------------------
     Water intake widget
     ----------------------------------------------------------- */
  function renderWaterWidget() {
    const percent = Math.min(100, Math.round((waterState.count / WATER_GOAL) * 100));
    dom.waterFill.style.setProperty('--fill', `${percent}%`);
    dom.waterCountValue.textContent = waterState.count;
    dom.waterDecrement.disabled = waterState.count <= 0;
    dom.waterIncrement.disabled = waterState.count >= WATER_MAX;
  }

  function changeWaterCount(delta) {
    const nextCount = waterState.count + delta;
    if (nextCount < 0 || nextCount > WATER_MAX) return;
    waterState.count = nextCount;
    waterState.date = todayDateStr();
    saveWaterState();
    renderWaterWidget();
    if (delta > 0 && waterState.count === WATER_GOAL) {
      showToast('Daily water goal reached!', 'success');
    }
  }

  /* -----------------------------------------------------------
     DOM caching & wiring
     ----------------------------------------------------------- */
  function cacheDom() {
    dom.loadingScreen = document.getElementById('loading-screen');
    dom.themeToggle = document.getElementById('theme-toggle');
    dom.notificationToggle = document.getElementById('notification-toggle');
    dom.notificationDot = document.getElementById('notification-dot');

    dom.onboardingCard = document.getElementById('onboarding-card');
    dom.onboardingDismiss = document.getElementById('onboarding-dismiss');
    dom.onboardingCta = document.getElementById('onboarding-cta');

    dom.summaryTakenValue = document.getElementById('summary-taken-value');
    dom.summaryUpcomingValue = document.getElementById('summary-upcoming-value');
    dom.summaryMissedValue = document.getElementById('summary-missed-value');
    dom.summaryMessage = document.getElementById('summary-message');

    dom.statTotalValue = document.getElementById('stat-total-value');
    dom.statStreakValue = document.getElementById('stat-streak-value');
    dom.statAdherenceValue = document.getElementById('stat-adherence-value');
    dom.statNextdoseValue = document.getElementById('stat-nextdose-value');

    dom.medicineSearch = document.getElementById('medicine-search');
    dom.filterChipGroup = document.getElementById('filter-chip-group');
    dom.medicineSort = document.getElementById('medicine-sort');
    dom.medicineList = document.getElementById('medicine-list');
    dom.timelineList = document.getElementById('timeline-list');

    dom.nextMedicineName = document.getElementById('next-medicine-name');
    dom.nextMedicineTime = document.getElementById('next-medicine-time');
    dom.countdownValues = Array.from(document.querySelectorAll('.countdown-value'));

    dom.circularProgress = document.querySelector('.circular-progress');
    dom.circularProgressValue = document.querySelector('.circular-progress-value');
    const progressStatValues = document.querySelectorAll('.progress-stats .stat-item dd');
    dom.progressTakenValue = progressStatValues[0];
    dom.progressMissedValue = progressStatValues[1];
    dom.progressAdherenceValue = progressStatValues[2];

    dom.healthTipIcon = document.getElementById('health-tip-icon');
    dom.healthTipText = document.getElementById('health-tip-text');
    dom.healthTipNext = document.getElementById('health-tip-next');

    dom.waterFill = document.getElementById('water-fill');
    dom.waterCountValue = document.getElementById('water-count-value');
    dom.waterIncrement = document.getElementById('water-increment');
    dom.waterDecrement = document.getElementById('water-decrement');

    dom.addMedicineFab = document.getElementById('add-medicine-fab');

    dom.medicineModalOverlay = document.getElementById('medicine-modal-overlay');
    dom.medicineModalTitle = document.getElementById('medicine-modal-title');
    dom.medicineModalClose = document.getElementById('medicine-modal-close');
    dom.medicineForm = document.getElementById('medicine-form');
    dom.medicineNameInput = document.getElementById('medicine-name-input');
    dom.medicineNameError = document.getElementById('medicine-name-error');
    dom.medicineTypeSelect = document.getElementById('medicine-type-select');
    dom.medicineTypeError = document.getElementById('medicine-type-error');
    dom.medicineDosageInput = document.getElementById('medicine-dosage-input');
    dom.medicineDosageError = document.getElementById('medicine-dosage-error');
    dom.medicineTimeInput = document.getElementById('medicine-time-input');
    dom.medicineTimeError = document.getElementById('medicine-time-error');
    dom.medicineFormSubmit = document.getElementById('medicine-form-submit');
    dom.medicineFormCancel = document.getElementById('medicine-form-cancel');

    dom.confirmModalOverlay = document.getElementById('confirm-modal-overlay');
    dom.confirmTitle = document.getElementById('confirm-title');
    dom.confirmMessage = document.getElementById('confirm-message');
    dom.confirmConfirmBtn = document.getElementById('confirm-confirm-btn');
    dom.confirmCancelBtn = document.getElementById('confirm-cancel-btn');

    dom.detailsModalOverlay = document.getElementById('details-modal-overlay');
    dom.detailsModalClose = document.getElementById('details-modal-close');
    dom.detailsName = document.getElementById('details-name');
    dom.detailsType = document.getElementById('details-type');
    dom.detailsDosage = document.getElementById('details-dosage');
    dom.detailsTime = document.getElementById('details-time');
    dom.detailsStatusBadge = document.getElementById('details-status-badge');
    dom.detailsEditBtn = document.getElementById('details-edit-btn');
    dom.detailsDeleteBtn = document.getElementById('details-delete-btn');
    dom.detailsCloseBtn = document.getElementById('details-close-btn');

    dom.reminderModalOverlay = document.getElementById('reminder-modal-overlay');
    dom.reminderMessage = document.getElementById('reminder-message');
    dom.reminderTakenBtn = document.getElementById('reminder-taken-btn');
    dom.reminderDismissBtn = document.getElementById('reminder-dismiss-btn');

    dom.toastContainer = document.getElementById('toast-container');
    dom.medicineCardTemplate = document.getElementById('medicine-card-template');
    dom.timelineItemTemplate = document.getElementById('timeline-item-template');
    dom.toastTemplate = document.getElementById('toast-template');
    dom.emptyStateTemplate = document.getElementById('empty-state-template');
  }

  function wireControls() {
    dom.medicineSearch.addEventListener('input', debounce((event) => {
      searchTerm = event.target.value.trim().toLowerCase();
      renderMedicineList();
    }, 200));

    dom.filterChipGroup.addEventListener('click', (event) => {
      const chip = event.target.closest('.filter-chip');
      if (!chip) return;
      activeFilter = chip.dataset.filter;
      dom.filterChipGroup.querySelectorAll('.filter-chip').forEach((btn) => btn.classList.toggle('is-active', btn === chip));
      renderMedicineList();
    });

    dom.medicineSort.addEventListener('change', (event) => {
      activeSort = event.target.value;
      renderMedicineList();
    });
  }

  function wireModals() {
    dom.medicineForm.addEventListener('submit', handleMedicineFormSubmit);
    dom.medicineModalClose.addEventListener('click', () => closeModal(dom.medicineModalOverlay));
    dom.medicineFormCancel.addEventListener('click', () => closeModal(dom.medicineModalOverlay));

    dom.confirmConfirmBtn.addEventListener('click', () => {
      if (confirmHandler) confirmHandler();
      closeModal(dom.confirmModalOverlay);
    });
    dom.confirmCancelBtn.addEventListener('click', () => closeModal(dom.confirmModalOverlay));

    dom.detailsModalClose.addEventListener('click', () => closeModal(dom.detailsModalOverlay));
    dom.detailsCloseBtn.addEventListener('click', () => closeModal(dom.detailsModalOverlay));
    dom.detailsEditBtn.addEventListener('click', () => {
      const medicine = medicines.find((m) => m.id === detailsMedicineId);
      closeModal(dom.detailsModalOverlay);
      if (medicine) openMedicineForm(medicine);
    });
    dom.detailsDeleteBtn.addEventListener('click', () => deleteMedicine(detailsMedicineId));

    wireModalDismissals();
  }

  function wireGlobalControls() {
    dom.themeToggle.addEventListener('click', toggleTheme);
    dom.notificationToggle.addEventListener('click', requestNotificationPermission);
    dom.addMedicineFab.addEventListener('click', () => openMedicineForm());
    dom.onboardingCta.addEventListener('click', () => openMedicineForm());
    dom.onboardingDismiss.addEventListener('click', dismissOnboarding);
    dom.healthTipNext.addEventListener('click', showNextHealthTip);
    dom.waterIncrement.addEventListener('click', () => changeWaterCount(1));
    dom.waterDecrement.addEventListener('click', () => changeWaterCount(-1));
    attachButtonPressAnimation();
  }

  /* -----------------------------------------------------------
     Render orchestration & bootstrap
     ----------------------------------------------------------- */
  function renderAll() {
    const stats = computeStats();
    renderMedicineList();
    renderTimeline();
    renderSummary(stats);
    renderQuickStats(stats);
    renderProgress(stats);
    refreshNextReminder();
    evaluateOnboardingVisibility();
  }

  function initApp() {
    cacheDom();
    initTheme();
    loadMedicines();
    loadWaterState();

    notificationsEnabled = ('Notification' in window) && Notification.permission === 'granted';
    updateNotificationIndicator();

    healthTipIndex = Math.floor(Math.random() * HEALTH_TIPS.length);
    renderHealthTip();
    renderWaterWidget();

    renderAll();
    startCountdownTimer();

    wireControls();
    wireModals();
    wireGlobalControls();

    setTimeout(hideLoadingScreen, 500);
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
