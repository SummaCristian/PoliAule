import { classroomsData, findAvailableClassrooms } from './available-rooms-script.js';

// ---------- THEME COLOR META TAGS ----------
const lightMeta = document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: light)"]');
const darkMeta = document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]');
const mq = window.matchMedia('(prefers-color-scheme: dark)');

function updateThemeColor(e) {
  // Force Safari to re-read by briefly swapping content
  if (e.matches) {
    darkMeta.content = '#1E1E1E';
  } else {
    lightMeta.content = '#ECECEC';
  }
}

mq.addEventListener('change', updateThemeColor);

// ---------- TAB BAR ----------
// Setup the Tab bar to switch between tabs
const tabbar = document.querySelector(".tabbar");
const tabs = document.querySelectorAll(".tab");
const indicator = document.querySelector(".tab-indicator");

const contentContainers = document.querySelectorAll(".tab-content");

tabbar.style.setProperty("--tabs", tabs.length);

// Show a given tab and hide the other(s)
function showContent(targetId) {
  contentContainers.forEach(container => {
    if (container.id === targetId) {
      container.style.display = 'block';
      requestAnimationFrame(() => container.classList.add('visible'));
    } else {
      container.classList.remove('visible');
      container.style.display = 'none'; // hide immediately, no waiting for animationend
    }
  });
}

// Assign click handlers to tabs
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => {

    // Show the corresponding content
    const targetId = tab.dataset.target;
    showContent(targetId);

    // Update active tab and indicator
    document.querySelector(".tab.active")?.classList.remove("active");
    tab.classList.add("active");

    indicator.style.transform = `translateX(${index * 100}%)`;
  });
});

// ---------- FORM 1: AVAILABLE CLASSROOMS ----------
// Setup the 'Available Classrooms' form
document.getElementById('available-classrooms-form').addEventListener('submit', (e) => {
  // Skip default submit behavior since we will handle it with JavaScript
  e.preventDefault();

  // Check if data was already fetched
  if (!classroomsData.length) {
    console.warn('Data not yet loaded, please wait...');
    return;
  }

  // Read input data
  const data = new FormData(e.target);
  const campus = data.get('campus');
  const date = data.get('date');
  const from = data.get('from');
  const to = data.get('to');

  console.log('Form submitted with:', { campus, date, from, to });

  // Compute results
  const results = findAvailableClassrooms(campus, date, from, to);
  console.log(results);

  // Render results
  renderAvailableClassroomsResults(results);
});

// Builds the UI to show the results of the 'Available Classrooms' form submission,
function renderAvailableClassroomsResults(results) {
  const container = document.getElementById('available-classrooms-results');
  container.innerHTML = ''; // Clear previous results

  if (results.length === 0) {
    container.textContent = 'No available classrooms found for the selected criteria.';
    return;
  }

  const list = document.createElement('ul');

  results.forEach(building => {
    const buildingItem = document.createElement('li');
    buildingItem.innerHTML = `<h3>${building.building.name}</h3>`;
    
    const roomsList = document.createElement('ul');
    building.rooms.forEach(room => {
      const roomItem = document.createElement('li');
      roomItem.innerHTML = `<p>${room.name} - Available from ${room.slots[0].start} to ${room.slots[0].end}</p>`;
      roomsList.appendChild(roomItem);
    });

    buildingItem.appendChild(roomsList);
    list.appendChild(buildingItem);
  });

  container.appendChild(list);
}