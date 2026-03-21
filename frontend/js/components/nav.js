// Navigation component
const Nav = {
    updateActive(page) {
        // Sidebar nav
        document.querySelectorAll('.nav-item').forEach(item => {
            const isActive = item.dataset.page === page;
            item.classList.toggle('bg-surface-container-high', isActive);
            item.classList.toggle('text-primary', isActive);
            item.classList.toggle('font-bold', isActive);
            item.classList.toggle('border-r-2', isActive);
            item.classList.toggle('border-primary', isActive);
            item.classList.toggle('text-outline', !isActive);
            // Set filled icon for active
            const icon = item.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.classList.toggle('filled', isActive);
            }
        });

        // Mobile nav
        document.querySelectorAll('.mobile-nav-item').forEach(item => {
            const isActive = item.dataset.page === page;
            item.classList.toggle('text-primary', isActive);
            item.classList.toggle('scale-110', isActive);
            item.classList.toggle('text-outline', !isActive);
            const icon = item.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.classList.toggle('filled', isActive);
            }
        });
    }
};
