/* =============================================================
   Medicine Reminder — Application Logic
   Vanilla ES6+, no external libraries. Renders medicine cards,
   manages reminders/notifications, and persists data locally.
   ============================================================= */

(function () {
  'use strict';

  /* -----------------------------------------------------------
     Constants & configuration
     ----------------------------------------------------------- */
  const STORAGE_KEY = 'medicineReminderData';
  const TOAST_DURATION_MS = 3500;
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

  const TOAST_STYLES = {
    success: { color: 'var(--color-taken)', icon: 'fa-solid fa-circle-check' },
    error: { color: 'var(--color-missed)', icon: 'fa-solid fa-circle-xmark' },
    warning: { color: 'var(--color-upcoming)', icon: 'fa-solid fa-triangle-exclamation' },
    info: { color: 'var(--color-primary-600)', icon: 'fa-solid fa-circle-info' },
  };

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
  let activeFilter = 'today'; // today | tomorrow | upcoming | taken | missed
  let activeSort = 'time'; // time | period
  let notificationsEnabled = false;
  let audioContext = null;
  let nextReminder = null; // { medicine, targetDate }
  const dom = {};

  /* -----------------------------------------------------------
     Small DOM-building helper (keeps card/modal code readable,
     never uses innerHTML for dynamic/user-supplied data).
     ----------------------------------------------------------- */
  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(options).forEach(([key, value]) => {
      if (value == null) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value);
    });
    children.forEach((child) => {
      if (child == null) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  /* -----------------------------------------------------------
     Utilities: time formatting & parsing
     ----------------------------------------------------------- */
  function formatTime12Hour(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours % 12 === 0 ? 12 : hours % 12;
    return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
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

  function persistAndRefresh() {
    saveMedicines();
    renderMedicineList();
    renderProgress();
    refreshNextReminder();
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
    return { taken, missed, upcoming, adherence };
  }

  /* -----------------------------------------------------------
     Number / circular-progress animations
     ----------------------------------------------------------- */
  function animateNumber(targetEl, toValue, suffix = '') {
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
    const currentText = dom.circularProgress.style.getPropertyValue('--progress');
    const fromPercent = currentText ? parseInt(currentText, 10) : parseInt(dom.circularProgressValue.textContent, 10) || 0;
    const duration = 700;
    const startTime = performance.now();

    function tick(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(fromPercent + (toPercent - fromPercent) * eased);
      dom.circularProgress.style.setProperty('--progress', `${current}%`);
      dom.circularProgress.style.background =
        `conic-gradient(var(--color-primary-500) ${current}%, var(--color-primary-100) 0)`;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    dom.circularProgress.setAttribute('aria-label', `Weekly adherence: ${toPercent} percent`);
  }

  function renderProgress() {
    const stats = computeStats();
    animateNumber(dom.statTakenValue, stats.taken);
    animateNumber(dom.statMissedValue, stats.missed);
    animateNumber(dom.statAdherenceValue, stats.adherence, '%');
    animateNumber(dom.circularProgressValue, stats.adherence, '%');
    animateCircularProgress(stats.adherence);
  }

  /* -----------------------------------------------------------
     Medicine list: filter, search, sort, render (with FLIP
     "move card" animation between renders)
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
      case 'tomorrow':
      case 'today':
      default:
        break; // no status filtering
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

  function buildEmptyState() {
    return el('li', { style: { textAlign: 'center', padding: '32px 12px', color: 'var(--text-muted)' } }, [
      el('i', { class: 'fa-regular fa-face-smile', style: { fontSize: '1.4rem', display: 'block', marginBottom: '8px' } }),
      el('span', { text: 'No medicines match your search or filters.' }),
    ]);
  }

  function buildMedicineCard(medicine, { interactive = true, displayStatus = null } = {}) {
    const status = displayStatus || medicine.status;
    const meta = STATUS_META[status] || STATUS_META.upcoming;
    const nameId = `${medicine.id}-name`;

    const typeIconWrap = el('div', { class: 'medicine-type-icon', 'aria-hidden': 'true' }, [
      el('i', { class: TYPE_ICON[medicine.type] || 'fa-solid fa-pills' }),
    ]);

    const nameBlock = el('div', {}, [
      el('h3', { class: 'medicine-name', id: nameId, text: medicine.name }),
      el('p', { class: 'medicine-type', text: medicine.type }),
    ]);

    const badge = el('span', { class: `status-badge ${meta.badgeClass}` }, [
      el('i', { class: meta.icon, 'aria-hidden': 'true' }),
      ` ${meta.label}`,
    ]);

    const header = el('header', { class: 'medicine-card-header' }, [typeIconWrap, nameBlock, badge]);

    const dosageItem = el('div', { class: 'detail-item' }, [
      el('dt', { text: 'Dosage' }),
      el('dd', { text: medicine.dosage }),
    ]);

    const timeDd = document.createElement('dd');
    const timeTag = document.createElement('time');
    timeTag.setAttribute('datetime', medicine.time);
    timeTag.textContent = formatTime12Hour(medicine.time);
    timeDd.appendChild(timeTag);
    const timeItem = el('div', { class: 'detail-item' }, [el('dt', { text: 'Time' }), timeDd]);

    const detailsList = el('dl', { class: 'medicine-details' }, [dosageItem, timeItem]);

    const takenBtn = el('button', {
      type: 'button',
      class: 'btn btn-primary',
      onclick: () => markAsTaken(medicine.id),
    }, [el('i', { class: 'fa-solid fa-check', 'aria-hidden': 'true' }), ' Mark as Taken']);

    const skipBtn = el('button', {
      type: 'button',
      class: 'btn btn-secondary',
      onclick: () => skipMedicine(medicine.id),
    }, [el('i', { class: 'fa-solid fa-forward', 'aria-hidden': 'true' }), ' Skip']);

    const detailsBtn = el('button', {
      type: 'button',
      class: 'btn btn-text',
      'aria-label': `View details for ${medicine.name}`,
      onclick: () => viewDetails(medicine.id),
    }, [el('i', { class: 'fa-solid fa-circle-info', 'aria-hidden': 'true' }), ' View Details']);

    if (!interactive || status !== 'upcoming') {
      takenBtn.disabled = true;
      skipBtn.disabled = true;
    }

    const actions = el('div', { class: 'medicine-actions' }, [takenBtn, skipBtn, detailsBtn]);

    const article = el('article', { class: 'medicine-card', 'aria-labelledby': nameId }, [header, detailsList, actions]);

    return el('li', {
      class: 'medicine-item',
      id: `medicine-item-${medicine.id}`,
      'data-medicine-id': medicine.id,
    }, [article]);
  }

  function renderMedicineList() {
    const listEl = dom.medicineList;
    if (!listEl) return;

    // Capture current card positions for the FLIP "move card" animation.
    const previousRects = new Map();
    Array.from(listEl.children).forEach((child) => {
      const id = child.dataset && child.dataset.medicineId;
      if (id) previousRects.set(id, child.getBoundingClientRect());
    });

    const items = getFilteredSortedMedicines();
    const isTomorrowPreview = activeFilter === 'tomorrow';

    listEl.textContent = '';
    if (items.length === 0) {
      listEl.appendChild(buildEmptyState());
      return;
    }

    items.forEach((medicine) => {
      const card = buildMedicineCard(medicine, {
        interactive: !isTomorrowPreview,
        displayStatus: isTomorrowPreview ? 'upcoming' : null,
      });
      listEl.appendChild(card);
    });

    // Animate cards into their new positions / fade in new cards.
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
     Success / press animations
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
      const button = event.target.closest('.btn, .fab, .icon-button');
      if (!button) return;
      button.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(0.93)' }, { transform: 'scale(1)' }],
        { duration: 220, easing: 'ease-out' }
      );
    });
  }

  /* -----------------------------------------------------------
     Medicine actions: mark as taken / skip / view / delete
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
      confirmClass: 'btn-danger',
      onConfirm: () => {
        playStatusChangeAnimation(id, 'var(--color-missed-bg)').then(() => {
          medicine.status = 'missed';
          persistAndRefresh();
          showToast('Medicine Updated', 'warning');
        });
      },
    });
  }

  function deleteMedicine(id, closeAfter) {
    const medicine = medicines.find((m) => m.id === id);
    if (!medicine) return;

    showConfirm({
      title: 'Delete medicine?',
      message: `This will permanently remove ${medicine.name} from your list.`,
      confirmLabel: 'Delete',
      confirmClass: 'btn-danger',
      onConfirm: () => {
        medicines = medicines.filter((m) => m.id !== id);
        persistAndRefresh();
        showToast('Medicine Deleted', 'error');
        if (closeAfter) closeAfter();
      },
    });
  }

  function viewDetails(id) {
    const medicine = medicines.find((m) => m.id === id);
    if (!medicine) return;

    const meta = STATUS_META[medicine.status];
    const panel = modalPanel([
      el('h2', { text: medicine.name, style: { marginBottom: '4px' } }),
      el('p', { text: medicine.type, style: { color: 'var(--text-muted)', marginBottom: '16px', textTransform: 'uppercase', fontSize: '0.8rem', letterSpacing: '0.05em' } }),
      el('dl', { class: 'medicine-details', style: { marginBottom: '16px' } }, [
        el('div', { class: 'detail-item' }, [el('dt', { text: 'Dosage' }), el('dd', { text: medicine.dosage })]),
        el('div', { class: 'detail-item' }, [el('dt', { text: 'Time' }), el('dd', { text: formatTime12Hour(medicine.time) })]),
      ]),
      el('span', { class: `status-badge ${meta.badgeClass}`, style: { marginBottom: '20px', display: 'inline-flex' } }, [
        el('i', { class: meta.icon, 'aria-hidden': 'true' }),
        ` ${meta.label}`,
      ]),
      el('div', { class: 'medicine-actions', style: { marginTop: '12px' } }, [
        el('button', {
          type: 'button',
          class: 'btn btn-secondary',
          onclick: () => openMedicineForm(medicine, () => closeOverlay(overlay)),
        }, [el('i', { class: 'fa-solid fa-pen', 'aria-hidden': 'true' }), ' Edit']),
        el('button', {
          type: 'button',
          class: 'btn btn-danger',
          onclick: () => deleteMedicine(medicine.id, () => closeOverlay(overlay)),
        }, [el('i', { class: 'fa-solid fa-trash', 'aria-hidden': 'true' }), ' Delete']),
        el('button', {
          type: 'button',
          class: 'btn btn-text',
          onclick: () => closeOverlay(overlay),
        }, ['Close']),
      ]),
    ]);

    const overlay = createOverlay(panel);
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
      return;
    }

    const totalSeconds = Math.floor(diffMs / 1000);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const [hrsEl, minsEl, secsEl] = dom.countdownValues;
    if (hrsEl) hrsEl.textContent = String(hrs).padStart(2, '0');
    if (minsEl) minsEl.textContent = String(mins).padStart(2, '0');
    if (secsEl) secsEl.textContent = String(secs).padStart(2, '0');
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
    let overlay;
    const panel = modalPanel([
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' } }, [
        el('span', {
          style: {
            width: '14px', height: '14px', borderRadius: '50%',
            background: 'var(--color-upcoming)', display: 'inline-block',
          },
        }),
        el('h2', { text: 'Reminder', style: { margin: '0' } }),
      ]),
      el('p', { text: `It's time to take ${medicine.name} (${medicine.dosage}, ${medicine.type}).`, style: { marginBottom: '20px', color: 'var(--text-secondary)' } }),
      el('div', { class: 'medicine-actions' }, [
        el('button', {
          type: 'button',
          class: 'btn btn-primary',
          onclick: () => {
            markAsTaken(medicine.id);
            showToast('Reminder Completed', 'success');
            closeOverlay(overlay);
          },
        }, [el('i', { class: 'fa-solid fa-check', 'aria-hidden': 'true' }), ' Mark as Taken']),
        el('button', {
          type: 'button',
          class: 'btn btn-secondary',
          onclick: () => closeOverlay(overlay),
        }, ['Dismiss']),
      ]),
    ]);
    overlay = createOverlay(panel);
  }

  function updateNotificationIndicator() {
    if (dom.notificationDot) {
      dom.notificationDot.style.display = notificationsEnabled ? 'block' : 'none';
    }
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
  function ensureToastContainer() {
    if (!dom.toastContainer) {
      dom.toastContainer = el('div', {
        'aria-live': 'polite',
        'aria-atomic': 'true',
        style: {
          position: 'fixed', top: '84px', right: '20px', display: 'flex',
          flexDirection: 'column', gap: '10px', zIndex: '200', maxWidth: '320px',
        },
      });
      document.body.appendChild(dom.toastContainer);
    }
    return dom.toastContainer;
  }

  function showToast(message, type = 'info') {
    const container = ensureToastContainer();
    const styleMeta = TOAST_STYLES[type] || TOAST_STYLES.info;

    const toast = el('div', {
      role: 'status',
      style: {
        display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px',
        borderRadius: '12px', background: 'var(--surface-card-solid)', color: 'var(--text-primary)',
        boxShadow: 'var(--shadow-lg)', borderLeft: `4px solid ${styleMeta.color}`,
        fontSize: '0.85rem', fontWeight: '600',
      },
    }, [
      el('i', { class: styleMeta.icon, style: { color: styleMeta.color } }),
      el('span', { text: message }),
    ]);

    container.appendChild(toast);
    toast.animate(
      [{ transform: 'translateX(30px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }],
      { duration: 250, easing: 'ease-out', fill: 'forwards' }
    );

    setTimeout(() => {
      const exitAnimation = toast.animate(
        [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(30px)', opacity: 0 }],
        { duration: 220, easing: 'ease-in', fill: 'forwards' }
      );
      exitAnimation.onfinish = () => toast.remove();
    }, TOAST_DURATION_MS);
  }

  /* -----------------------------------------------------------
     Generic modal overlay
     ----------------------------------------------------------- */
  function modalPanel(children, extraStyle = {}) {
    return el('div', {
      style: Object.assign({
        background: 'var(--surface-card-solid)', borderRadius: 'var(--radius-lg)',
        padding: '28px', maxWidth: '440px', width: '100%', boxShadow: 'var(--shadow-lg)',
        maxHeight: '86vh', overflowY: 'auto',
      }, extraStyle),
    }, children);
  }

  function createOverlay(contentEl) {
    const overlay = el('div', {
      role: 'presentation',
      style: {
        position: 'fixed', inset: '0', background: 'rgba(15, 36, 56, 0.45)',
        backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: '150', padding: '20px',
      },
    }, [contentEl]);

    function escHandler(event) {
      if (event.key === 'Escape') closeOverlay(overlay);
    }
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeOverlay(overlay); });
    document.addEventListener('keydown', escHandler);
    overlay._escHandler = escHandler;

    document.body.appendChild(overlay);
    overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' });
    contentEl.animate(
      [{ transform: 'translateY(16px) scale(0.97)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }],
      { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
    );
    return overlay;
  }

  function closeOverlay(overlay) {
    if (!overlay || !overlay.isConnected) return;
    document.removeEventListener('keydown', overlay._escHandler);
    const animation = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
    animation.onfinish = () => overlay.remove();
  }

  function showConfirm({ title, message, confirmLabel = 'Confirm', confirmClass = 'btn-primary', onConfirm }) {
    let overlay;
    const panel = modalPanel([
      el('h2', { text: title, style: { marginBottom: '10px' } }),
      el('p', { text: message, style: { color: 'var(--text-secondary)', marginBottom: '22px' } }),
      el('div', { class: 'medicine-actions' }, [
        el('button', {
          type: 'button',
          class: `btn ${confirmClass}`,
          onclick: () => { onConfirm(); closeOverlay(overlay); },
        }, [confirmLabel]),
        el('button', { type: 'button', class: 'btn btn-text', onclick: () => closeOverlay(overlay) }, ['Cancel']),
      ]),
    ]);
    overlay = createOverlay(panel);
  }

  /* -----------------------------------------------------------
     Add / edit medicine form modal
     ----------------------------------------------------------- */
  function buildFormField(labelText, inputEl, errorId) {
    const label = el('label', { style: { display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }, text: labelText });
    const errorSpan = el('span', { id: errorId, style: { display: 'block', color: 'var(--color-missed)', fontSize: '0.75rem', marginTop: '4px', minHeight: '14px' } });
    Object.assign(inputEl.style, {
      width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--surface-border)', background: 'var(--color-primary-50)',
      color: 'var(--text-primary)', fontSize: '0.9rem', fontFamily: 'inherit',
    });
    return el('div', { style: { marginBottom: '16px' } }, [label, inputEl, errorSpan]);
  }

  function openMedicineForm(existingMedicine = null, onClosed) {
    let overlay;
    const isEdit = Boolean(existingMedicine);

    const nameInput = el('input', { type: 'text', value: isEdit ? existingMedicine.name : '', 'aria-label': 'Medicine name' });
    const typeSelect = el('select', { 'aria-label': 'Medicine type' },
      MEDICINE_TYPES.map((type) => el('option', { value: type, text: type }))
    );
    if (isEdit) typeSelect.value = existingMedicine.type;

    const dosageInput = el('input', { type: 'text', value: isEdit ? existingMedicine.dosage : '', placeholder: 'e.g. 500 mg', 'aria-label': 'Dosage' });
    const timeInput = el('input', { type: 'time', value: isEdit ? existingMedicine.time : '', 'aria-label': 'Reminder time' });

    const nameField = buildFormField('Medicine Name', nameInput, 'error-name');
    const typeField = buildFormField('Medicine Type', typeSelect, 'error-type');
    const dosageField = buildFormField('Dosage', dosageInput, 'error-dosage');
    const timeField = buildFormField('Time', timeInput, 'error-time');

    function showFieldError(field, message) {
      const errorSpan = field.querySelector('span');
      if (errorSpan) errorSpan.textContent = message || '';
    }

    function handleSubmit(event) {
      event.preventDefault();
      const name = nameInput.value.trim();
      const dosage = dosageInput.value.trim();
      const time = timeInput.value.trim();
      const type = typeSelect.value;
      let hasError = false;

      showFieldError(nameField, '');
      showFieldError(dosageField, '');
      showFieldError(timeField, '');
      showFieldError(typeField, '');

      if (name.length < 2) { showFieldError(nameField, 'Please enter a valid name (2+ characters).'); hasError = true; }
      if (!dosage) { showFieldError(dosageField, 'Dosage is required.'); hasError = true; }
      if (!/^\d{2}:\d{2}$/.test(time)) { showFieldError(timeField, 'Please choose a valid time.'); hasError = true; }
      if (!MEDICINE_TYPES.includes(type)) { showFieldError(typeField, 'Please choose a medicine type.'); hasError = true; }

      if (hasError) {
        formPanel.animate(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }],
          { duration: 300, easing: 'ease-in-out' }
        );
        return;
      }

      if (isEdit) {
        Object.assign(existingMedicine, { name, dosage, time, type });
        showToast('Medicine Updated', 'success');
      } else {
        medicines.push({ id: generateId(), name, dosage, time, type, status: 'upcoming' });
        showToast('Medicine Added', 'success');
      }

      persistAndRefresh();
      closeOverlay(overlay);
      if (onClosed) onClosed();
    }

    const form = el('form', { onsubmit: handleSubmit }, [
      el('h2', { text: isEdit ? 'Edit Medicine' : 'Add New Medicine', style: { marginBottom: '18px' } }),
      nameField,
      typeField,
      dosageField,
      timeField,
      el('div', { class: 'medicine-actions', style: { marginTop: '6px' } }, [
        el('button', { type: 'submit', class: 'btn btn-primary' }, [el('i', { class: 'fa-solid fa-check', 'aria-hidden': 'true' }), isEdit ? ' Save Changes' : ' Add Medicine']),
        el('button', { type: 'button', class: 'btn btn-text', onclick: () => { closeOverlay(overlay); if (onClosed) onClosed(); } }, ['Cancel']),
      ]),
    ]);

    const formPanel = modalPanel([form]);
    overlay = createOverlay(formPanel);
    nameInput.focus();
  }

  /* -----------------------------------------------------------
     Search / filter / sort controls
     ----------------------------------------------------------- */
  function buildControlsBar() {
    const searchInput = el('input', {
      type: 'search',
      placeholder: 'Search medicines by name or type...',
      'aria-label': 'Search medicines',
      style: {
        width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--surface-border)', background: 'var(--color-primary-50)',
        fontSize: '0.88rem', fontFamily: 'inherit', color: 'var(--text-primary)',
      },
      oninput: debounce((event) => {
        searchTerm = event.target.value.trim().toLowerCase();
        renderMedicineList();
      }, 200),
    });

    const filters = [
      { value: 'today', label: 'Today' },
      { value: 'tomorrow', label: 'Tomorrow' },
      { value: 'taken', label: 'Taken' },
      { value: 'missed', label: 'Missed' },
      { value: 'upcoming', label: 'Upcoming' },
    ];

    const filterButtons = filters.map((filterOption) => {
      const button = el('button', {
        type: 'button',
        style: {
          padding: '7px 14px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--surface-border)',
          background: filterOption.value === activeFilter ? 'var(--color-primary-600)' : 'var(--surface-card-solid)',
          color: filterOption.value === activeFilter ? '#fff' : 'var(--text-secondary)',
          fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer',
        },
        text: filterOption.label,
        onclick: () => {
          activeFilter = filterOption.value;
          Array.from(filterRow.children).forEach((btn, index) => {
            const isActive = filters[index].value === activeFilter;
            btn.style.background = isActive ? 'var(--color-primary-600)' : 'var(--surface-card-solid)';
            btn.style.color = isActive ? '#fff' : 'var(--text-secondary)';
          });
          renderMedicineList();
        },
      });
      return button;
    });

    const filterRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '12px 0' } }, filterButtons);

    const sortSelect = el('select', {
      'aria-label': 'Sort medicines',
      style: {
        padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--surface-border)',
        background: 'var(--surface-card-solid)', color: 'var(--text-primary)', fontSize: '0.82rem',
      },
      onchange: (event) => { activeSort = event.target.value; renderMedicineList(); },
    }, [
      el('option', { value: 'time', text: 'Sort by Exact Time' }),
      el('option', { value: 'period', text: 'Sort by Time of Day (Morning → Night)' }),
    ]);

    const sortRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' } }, [
      el('i', { class: 'fa-solid fa-arrow-down-wide-short', 'aria-hidden': 'true', style: { color: 'var(--text-muted)' } }),
      sortSelect,
    ]);

    return el('div', {}, [searchInput, filterRow, sortRow]);
  }

  /* -----------------------------------------------------------
     DOM caching & wiring
     ----------------------------------------------------------- */
  function cacheDom() {
    dom.medicinesCard = document.querySelector('.medicines-card');
    dom.medicinesHeading = document.getElementById('todays-medicines-heading');
    dom.medicineList = document.querySelector('.medicine-list');
    dom.fab = document.querySelector('.fab');
    dom.bellButton = document.querySelector('.icon-button[aria-label="View notifications"]');
    dom.notificationDot = document.querySelector('.notification-dot');

    dom.nextMedicineName = document.querySelector('.next-medicine-name');
    dom.nextMedicineTime = document.querySelector('.next-medicine-time');
    dom.countdownValues = Array.from(document.querySelectorAll('.countdown-value'));

    dom.circularProgress = document.querySelector('.circular-progress');
    dom.circularProgressValue = document.querySelector('.circular-progress-value');
    const statValues = document.querySelectorAll('.stat-item dd');
    dom.statTakenValue = statValues[0];
    dom.statMissedValue = statValues[1];
    dom.statAdherenceValue = statValues[2];
  }

  function wireGlobalControls() {
    if (dom.fab) dom.fab.addEventListener('click', () => openMedicineForm());
    if (dom.bellButton) dom.bellButton.addEventListener('click', requestNotificationPermission);
    attachButtonPressAnimation();
  }

  /* -----------------------------------------------------------
     App bootstrap
     ----------------------------------------------------------- */
  function initApp() {
    cacheDom();
    loadMedicines();

    if (dom.medicinesHeading) {
      dom.medicinesHeading.insertAdjacentElement('afterend', buildControlsBar());
    }

    notificationsEnabled = ('Notification' in window) && Notification.permission === 'granted';
    updateNotificationIndicator();

    renderMedicineList();
    renderProgress();
    refreshNextReminder();
    startCountdownTimer();
    wireGlobalControls();
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
