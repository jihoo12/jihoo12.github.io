
const toggleBtn = document.getElementById('theme-toggle');
const body = document.body;
const icon = toggleBtn.querySelector('.icon');
const currentTheme = localStorage.getItem('theme');
if (currentTheme === 'dark') {
    body.classList.add('dark-mode');
    icon.textContent = '🌙';
}

toggleBtn.addEventListener('click', () => {
    body.classList.toggle('dark-mode');

    if (body.classList.contains('dark-mode')) {
        icon.textContent = '🌙';
        localStorage.setItem('theme', 'dark');
    } else {
        icon.textContent = '☀️';
        localStorage.setItem('theme', 'light');
    }
});