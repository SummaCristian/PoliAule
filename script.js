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

const tabbar = document.querySelector(".tabbar");
const tabs = document.querySelectorAll(".tab");
const indicator = document.querySelector(".tab-indicator");

const contentContainers = document.querySelectorAll(".tab-content");

tabbar.style.setProperty("--tabs", tabs.length);

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