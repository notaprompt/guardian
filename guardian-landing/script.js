/* ═══════════════════════════════════════════════════════════════ */
/* Guardian Landing — Minimal JS                                  */
/* Scroll reveals, orb interactivity, mobile menu                 */
/* ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Scroll Reveal ────────────────────────────────────────── */

  var revealElements = document.querySelectorAll('.reveal');

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal--visible');
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.1,
      rootMargin: '0px 0px -40px 0px',
    }
  );

  revealElements.forEach(function (el) {
    observer.observe(el);
  });

  /* ── Nav scroll state ─────────────────────────────────────── */

  var nav = document.querySelector('.nav');
  var scrolled = false;

  function onScroll() {
    var shouldBeScrolled = window.scrollY > 40;
    if (shouldBeScrolled !== scrolled) {
      scrolled = shouldBeScrolled;
      if (scrolled) {
        nav.classList.add('nav--scrolled');
      } else {
        nav.classList.remove('nav--scrolled');
      }
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ── Mobile Menu ──────────────────────────────────────────── */

  var toggle = document.querySelector('.nav__toggle');
  var mobileMenu = document.querySelector('.mobile-menu');
  var menuLinks = document.querySelectorAll('.mobile-menu__link, .mobile-menu__cta');

  function toggleMenu() {
    var isOpen = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    mobileMenu.classList.toggle('mobile-menu--open');
    mobileMenu.setAttribute('aria-hidden', String(isOpen));
    document.body.style.overflow = isOpen ? '' : 'hidden';
  }

  toggle.addEventListener('click', toggleMenu);

  menuLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      if (mobileMenu.classList.contains('mobile-menu--open')) {
        toggleMenu();
      }
    });
  });

  /* ── Smooth scroll for anchor links ───────────────────────── */

  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var targetId = this.getAttribute('href');
      if (targetId === '#') return;
      var target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        var offset = 60; // nav height
        var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: top, behavior: 'smooth' });
      }
    });
  });

  /* ── Orb parallax on mouse move ───────────────────────────── */

  var warmOrb = document.querySelector('.orb--warm');
  var coolOrb = document.querySelector('.orb--cool');
  var glowOrb = document.querySelector('.orb--glow');

  var mouseX = 0;
  var mouseY = 0;
  var currentX = 0;
  var currentY = 0;

  function onMouseMove(e) {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  }

  function animateOrbs() {
    // Smooth interpolation
    currentX += (mouseX - currentX) * 0.03;
    currentY += (mouseY - currentY) * 0.03;

    var warmDx = currentX * 20;
    var warmDy = currentY * 15;
    var coolDx = currentX * -15;
    var coolDy = currentY * -10;
    var glowDx = currentX * 8;
    var glowDy = currentY * 8;

    warmOrb.style.transform = 'translate(' + warmDx + 'px, ' + warmDy + 'px)';
    coolOrb.style.transform = 'translate(' + coolDx + 'px, ' + coolDy + 'px)';
    glowOrb.style.transform =
      'translate(calc(-50% + ' + glowDx + 'px), calc(-50% + ' + glowDy + 'px))';

    requestAnimationFrame(animateOrbs);
  }

  // Only enable on non-touch devices
  if (!('ontouchstart' in window)) {
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    requestAnimationFrame(animateOrbs);
  }

  /* ── Glyph hover glow ─────────────────────────────────────── */

  var heroGlyph = document.querySelector('.hero__glyph');
  if (heroGlyph) {
    heroGlyph.addEventListener('mouseenter', function () {
      heroGlyph.style.textShadow = '0 0 80px rgba(232, 220, 200, 0.5)';
    });
    heroGlyph.addEventListener('mouseleave', function () {
      heroGlyph.style.textShadow = '';
    });
  }

  /* ── Active nav link on scroll ────────────────────────────── */

  var sections = document.querySelectorAll('section[id]');
  var navLinks = document.querySelectorAll('.nav__link');

  var sectionObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var id = entry.target.getAttribute('id');
          navLinks.forEach(function (link) {
            if (link.getAttribute('href') === '#' + id) {
              link.style.color = 'var(--glow)';
            } else {
              link.style.color = '';
            }
          });
        }
      });
    },
    {
      threshold: 0.3,
    }
  );

  sections.forEach(function (section) {
    sectionObserver.observe(section);
  });
})();
