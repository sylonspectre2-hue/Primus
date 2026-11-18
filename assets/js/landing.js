document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = document.getElementById('menuToggle');
    const mainNav = document.getElementById('mainNav');
    const bagCount = document.getElementById('bagCount');
    const newsletterForm = document.getElementById('newsletterForm');
    const newsletterMessage = document.getElementById('newsletterMessage');

    function updateBagCount(value) {
        const count = Number.parseInt(value, 10);
        bagCount.textContent = String(Number.isFinite(count) && count > 0 ? count : 0);
    }

    updateBagCount(localStorage.getItem('primus-cart-count') || '0');
    window.addEventListener('storage', event => {
        if (event.key === 'primus-cart-count') updateBagCount(event.newValue || '0');
    });

    menuToggle.addEventListener('click', () => {
        const isOpen = mainNav.classList.toggle('is-open');
        menuToggle.setAttribute('aria-expanded', String(isOpen));
        menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    });

    mainNav.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            mainNav.classList.remove('is-open');
            menuToggle.setAttribute('aria-expanded', 'false');
            menuToggle.setAttribute('aria-label', 'Open navigation');
        });
    });

    newsletterForm.addEventListener('submit', event => {
        event.preventDefault();
        newsletterMessage.textContent = 'Thanks! Newsletter signup will be available when Primus is connected to its mailing service.';
        newsletterForm.reset();
    });
});
