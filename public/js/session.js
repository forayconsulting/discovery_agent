// Session quiz client logic

const API_BASE = '/api';
let sessionToken = null;
let currentBatch = null;
let selectedAnswers = {}; // { questionId: { optionIds: [], labels: [], noneOfTheAbove: bool, customText: '' } }

// Screens
const screens = {
  loading: document.getElementById('loading-screen'),
  error: document.getElementById('error-screen'),
  welcome: document.getElementById('welcome-screen'),
  completed: document.getElementById('completed-screen'),
  quiz: document.getElementById('quiz-screen'),
  submit: document.getElementById('submit-screen'),
  thankyou: document.getElementById('thankyou-screen'),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function showError(msg) {
  document.getElementById('error-text').textContent = msg;
  showScreen('error');
}

// Init
(async function init() {
  const params = new URLSearchParams(window.location.search);
  sessionToken = params.get('token');

  if (!sessionToken) {
    showError('No session token provided. Please check your link.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/session/${sessionToken}`);
    if (!res.ok) {
      showError('This session link is invalid or has expired.');
      return;
    }

    const data = await res.json();
    const session = data.session;

    if (session.status === 'completed') {
      showScreen('completed');
      return;
    }

    document.getElementById('welcome-name').textContent = session.stakeholderName;
    document.getElementById('welcome-engagement').textContent = session.engagementName;
    showScreen('welcome');
  } catch (err) {
    showError('Unable to load your session. Please try again later.');
  }
})();

// Start session
async function startSession() {
  const btn = document.getElementById('begin-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Loading...';

  try {
    const res = await fetch(`${API_BASE}/session/${sessionToken}/start`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      showError(err.error || 'Failed to start session.');
      return;
    }

    const data = await res.json();
    currentBatch = data.batch;

    if (!currentBatch.questions || currentBatch.questions.length === 0) {
      showError('Unable to generate questions. Please try again.');
      return;
    }

    renderBatch(currentBatch);
    showScreen('quiz');
  } catch (err) {
    showError('Unable to start the session. Please try again.');
  }
}

// Render quiz batch
function renderBatch(batch) {
  selectedAnswers = {};
  const container = document.getElementById('questions-container');
  container.innerHTML = '';

  document.getElementById('batch-indicator').textContent = `Batch ${batch.batchNumber}`;

  // Progress estimation (assume ~5 batches typical)
  const progress = Math.min((batch.batchNumber / 6) * 100, 90);
  document.getElementById('progress-fill').style.width = `${progress}%`;
  document.getElementById('progress-hint').textContent = batch.progressHint || '';

  batch.questions.forEach((q) => {
    const card = document.createElement('div');
    card.className = 'question-card';
    card.setAttribute('data-question-id', q.id);

    let html = `<div class="question-text">${escapeHtml(q.text)}</div>`;
    if (q.description) {
      html += `<div class="question-description">${escapeHtml(q.description)}</div>`;
    }

    html += '<div class="option-list">';

    const inputType = q.type === 'single' ? 'radio' : 'checkbox';
    const inputName = `q_${q.id}`;

    q.options.forEach((opt) => {
      html += `
        <label class="option-item" data-option-id="${opt.id}">
          <input type="${inputType}" name="${inputName}" value="${opt.id}"
            onchange="handleOptionChange('${q.id}', '${opt.id}', '${escapeAttr(opt.label)}', '${q.type}', this)">
          <span class="option-label">${escapeHtml(opt.label)}</span>
        </label>`;
    });

    if (q.allowNoneOfTheAbove) {
      html += `
        <label class="option-item" data-option-id="none">
          <input type="${inputType}" name="${inputName}" value="none"
            onchange="handleNoneOfAbove('${q.id}', '${q.type}', this)">
          <span class="option-label">None of the above</span>
        </label>`;
    }

    html += `
      <label class="option-item other-option" data-option-id="other">
        <input type="${inputType}" name="${inputName}" value="other"
          onchange="handleOther('${q.id}', '${q.type}', this)">
        <span class="option-label">Other:</span>
        <input type="text" class="other-text-input" placeholder="Please specify..."
          data-question-id="${q.id}" disabled
          oninput="handleOtherText('${q.id}', this.value)">
      </label>`;

    html += '</div>';
    card.innerHTML = html;
    container.appendChild(card);
  });

  updateNextButton();
}

function ensureAnswer(questionId) {
  if (!selectedAnswers[questionId]) {
    selectedAnswers[questionId] = { optionIds: [], labels: [], noneOfTheAbove: false, customText: '' };
  }
  return selectedAnswers[questionId];
}

function clearOther(questionId) {
  const card = document.querySelector(`.question-card[data-question-id="${questionId}"]`);
  const otherInput = card.querySelector('input[value="other"]');
  if (otherInput) otherInput.checked = false;
  const textInput = card.querySelector('.other-text-input');
  if (textInput) {
    textInput.disabled = true;
    textInput.value = '';
  }
  const answer = ensureAnswer(questionId);
  answer.customText = '';
}

function handleOptionChange(questionId, optionId, label, type, input) {
  const answer = ensureAnswer(questionId);

  if (type === 'single') {
    answer.optionIds = [optionId];
    answer.labels = [label];
    answer.noneOfTheAbove = false;
    clearOther(questionId);
  } else {
    // Uncheck none-of-above if selecting a real option
    if (answer.noneOfTheAbove) {
      answer.noneOfTheAbove = false;
      answer.optionIds = [];
      answer.labels = [];
      const noneInput = document.querySelector(
        `.question-card[data-question-id="${questionId}"] input[value="none"]`
      );
      if (noneInput) noneInput.checked = false;
    }

    if (input.checked) {
      answer.optionIds.push(optionId);
      answer.labels.push(label);
    } else {
      answer.optionIds = answer.optionIds.filter((id) => id !== optionId);
      answer.labels = answer.labels.filter((l) => l !== label);
    }
  }

  updateSelectionStyles(questionId);
  updateNextButton();
}

function handleNoneOfAbove(questionId, type, input) {
  const answer = ensureAnswer(questionId);

  if (input.checked) {
    answer.noneOfTheAbove = true;
    answer.optionIds = [];
    answer.labels = [];
    clearOther(questionId);
    // Uncheck all other options
    const card = document.querySelector(`.question-card[data-question-id="${questionId}"]`);
    card.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((inp) => {
      if (inp.value !== 'none') inp.checked = false;
    });
  } else {
    answer.noneOfTheAbove = false;
  }

  updateSelectionStyles(questionId);
  updateNextButton();
}

function handleOther(questionId, type, input) {
  const answer = ensureAnswer(questionId);
  const card = document.querySelector(`.question-card[data-question-id="${questionId}"]`);
  const textInput = card.querySelector('.other-text-input');

  if (input.checked) {
    textInput.disabled = false;
    textInput.focus();

    if (type === 'single') {
      answer.optionIds = [];
      answer.labels = [];
      answer.noneOfTheAbove = false;
    } else {
      // Uncheck none-of-above
      if (answer.noneOfTheAbove) {
        answer.noneOfTheAbove = false;
        const noneInput = card.querySelector('input[value="none"]');
        if (noneInput) noneInput.checked = false;
      }
    }
  } else {
    textInput.disabled = true;
    textInput.value = '';
    answer.customText = '';
  }

  updateSelectionStyles(questionId);
  updateNextButton();
}

function handleOtherText(questionId, value) {
  const answer = ensureAnswer(questionId);
  answer.customText = value;
  updateNextButton();
}

function updateSelectionStyles(questionId) {
  const card = document.querySelector(`.question-card[data-question-id="${questionId}"]`);
  const answer = selectedAnswers[questionId];

  card.querySelectorAll('.option-item').forEach((item) => {
    const optId = item.getAttribute('data-option-id');
    const otherChecked = card.querySelector('input[value="other"]')?.checked;
    const isSelected =
      (optId === 'other' && otherChecked) ||
      (optId === 'none' && answer?.noneOfTheAbove) ||
      (answer?.optionIds.includes(optId));
    item.classList.toggle('selected', isSelected);
  });
}

function updateNextButton() {
  const btn = document.getElementById('next-btn');
  // All questions must have at least one selection (or "Other" with text)
  const allAnswered = currentBatch.questions.every((q) => {
    const a = selectedAnswers[q.id];
    if (!a) return false;
    const hasOther = a.customText && a.customText.trim().length > 0;
    return a.optionIds.length > 0 || a.noneOfTheAbove || hasOther;
  });
  btn.disabled = !allAnswered;

  // Update button text based on isComplete
  btn.textContent = currentBatch.isComplete ? 'Continue' : 'Next';
}

// Submit answers for current batch
async function submitAnswers() {
  const btn = document.getElementById('next-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Loading...';

  const answers = currentBatch.questions.map((q) => {
    const a = selectedAnswers[q.id] || { optionIds: [], labels: [], noneOfTheAbove: false, customText: '' };
    const answer = {
      questionId: q.id,
      questionText: q.text,
      selectedOptionIds: a.optionIds,
      selectedLabels: a.labels,
      noneOfTheAbove: a.noneOfTheAbove,
    };
    if (a.customText && a.customText.trim()) {
      answer.customText = a.customText.trim();
    }
    return answer;
  });

  try {
    const res = await fetch(`${API_BASE}/session/${sessionToken}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to submit answers.');
      btn.disabled = false;
      btn.textContent = 'Next';
      return;
    }

    const data = await res.json();
    currentBatch = data.batch;

    if (currentBatch.isComplete && currentBatch.questions.length === 0) {
      showScreen('submit');
    } else {
      renderBatch(currentBatch);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } catch (err) {
    alert('Network error. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Next';
  }
}

// Final submit
async function submitSession() {
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating summary...';

  try {
    const res = await fetch(`${API_BASE}/session/${sessionToken}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to submit.');
      btn.disabled = false;
      btn.textContent = 'Submit Results';
      return;
    }

    showScreen('thankyou');
  } catch (err) {
    alert('Network error. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Submit Results';
  }
}

// Helpers
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}
