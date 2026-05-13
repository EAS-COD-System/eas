(function() {
  'use strict';

  // ==================== REVEAL ON SCROLL ====================
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length > 0) {
    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.1 });
    revealEls.forEach(function(el) { observer.observe(el); });
  }

  // ==================== FAQ ACCORDION ====================
  document.querySelectorAll('.faq-question').forEach(function(q) {
    q.addEventListener('click', function() {
      var item = this.parentElement;
      var isOpen = item.classList.contains('open');
      // Close all
      document.querySelectorAll('.faq-item').forEach(function(x) { x.classList.remove('open'); });
      if (!isOpen) item.classList.add('open');
    });
  });

  // ==================== BUNDLE SELECTOR ====================
  document.querySelectorAll('.bundle-options').forEach(function(group) {
    group.querySelectorAll('.bundle-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        group.querySelectorAll('.bundle-option').forEach(function(x) { x.classList.remove('selected'); });
        this.classList.add('selected');
      });
    });
  });

  // ==================== STICKY BAR ====================
  var hero = document.querySelector('.hero');
  var stickyBar = document.querySelector('.sticky-bar');
  if (hero && stickyBar) {
    window.addEventListener('scroll', function() {
      stickyBar.style.display = hero.getBoundingClientRect().bottom < 0 ? 'flex' : 'none';
    });
  }

  // Sticky bar button
  var stickyBtn = document.getElementById('sticky-btn');
  if (stickyBtn) {
    stickyBtn.addEventListener('click', function() {
      var orderSection = document.getElementById('order');
      if (orderSection) {
        orderSection.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  // ==================== ORDER FORM (Men & Women) ====================
  var orderBtn = document.getElementById('order-btn');
  if (orderBtn) {
    orderBtn.addEventListener('click', function(e) {
      e.preventDefault();
      var name = document.getElementById('order-name');
      var phone = document.getElementById('order-phone');
      var location = document.getElementById('order-location');
      var nameVal = name ? name.value.trim() : '';
      var phoneVal = phone ? phone.value.trim() : '';
      var locVal = location ? location.value.trim() : '';

      if (!nameVal || !phoneVal || !locVal) {
        alert('Please fill in your name, phone number and delivery location.');
        return;
      }

      var selectedBundle = document.querySelector('.bundle-option.selected');
      var bundleName = selectedBundle ? selectedBundle.querySelector('.bundle-option-label').textContent : '2 Bottles';
      var bundlePrice = selectedBundle ? selectedBundle.querySelector('.bundle-option-price').textContent : 'KSH 5,499';

      // Detect page type
      var isWomen = document.body.classList.contains('rose-theme');
      var productName = isWomen ? 'AUDORA ROSE NOIR — Women\'s Fragrance' : 'AUDORA BLACK OUD — Men\'s Fragrance';

      var msg = 'Hello AUDORA!\n\n' +
        'Order:\n' +
        'Product: ' + productName + '\n' +
        'Bundle: ' + bundleName + '\n' +
        'Total: ' + bundlePrice + '\n' +
        'Name: ' + nameVal + '\n' +
        'Phone: ' + phoneVal + '\n' +
        'Location: ' + locVal + '\n\n' +
        'Please confirm. Thank you!';

      // REPLACE WITH YOUR REAL WHATSAPP NUMBER
      window.open('https://wa.me/254700000000?text=' + encodeURIComponent(msg), '_blank');
    });
  }

  // ==================== GIFT PAGE LOGIC ====================
  var giftSection = document.getElementById('gift-section');
  if (giftSection) {
    var selectedRecipient = null;

    var recipientBtns = {
      h: document.getElementById('gift-btn-h'),
      w: document.getElementById('gift-btn-w'),
      c: document.getElementById('gift-btn-c')
    };

    var checkMarks = {
      h: document.getElementById('gift-check-h'),
      w: document.getElementById('gift-check-w'),
      c: document.getElementById('gift-check-c')
    };

    var continueBtn = document.getElementById('gift-continue');
    var step1Num = document.getElementById('gift-step-1');
    var step2Num = document.getElementById('gift-step-2');
    var step1Label = document.getElementById('gift-step-label-1');
    var step2Label = document.getElementById('gift-step-label-2');
    var step1Content = document.getElementById('gift-step-1-content');
    var step2Content = document.getElementById('gift-step-2-content');

    function selectRecipient(type) {
      selectedRecipient = type;
      // Reset all
      Object.keys(recipientBtns).forEach(function(k) {
        recipientBtns[k].classList.remove('selected-him', 'selected-her');
        checkMarks[k].style.display = 'none';
      });
      // Set selected
      if (type === 'w') {
        recipientBtns[type].classList.add('selected-her');
      } else {
        recipientBtns[type].classList.add('selected-him');
      }
      checkMarks[type].style.display = 'flex';
      continueBtn.style.display = 'block';

      if (type === 'w') {
        continueBtn.className = 'btn btn-rose';
        continueBtn.textContent = 'Continue to Order';
      } else {
        continueBtn.className = 'btn btn-gold';
        continueBtn.textContent = 'Continue to Order';
      }
    }

    recipientBtns.h.addEventListener('click', function() { selectRecipient('h'); });
    recipientBtns.w.addEventListener('click', function() { selectRecipient('w'); });
    recipientBtns.c.addEventListener('click', function() { selectRecipient('c'); });

    continueBtn.addEventListener('click', function() {
      if (!selectedRecipient) return;

      var isWomen = selectedRecipient === 'w';
      var isCouple = selectedRecipient === 'c';
      var themeClass = isWomen ? 'rose-theme' : '';
      var accentColor = isWomen ? 'var(--rose-light)' : 'var(--gold-light)';
      var borderColor = isWomen ? 'var(--rose)' : 'var(--gold)';
      var bgSelected = isWomen ? 'rgba(196,137,110,.06)' : 'rgba(201,168,76,.06)';
      var badgeBg = isWomen ? 'var(--rose)' : 'var(--gold)';
      var badgeColor = isWomen ? '#fff' : '#080808';
      var btnClass = isWomen ? 'btn-rose' : 'btn-gold';

      // Update step indicator
      step1Num.classList.remove('active');
      step1Num.style.background = 'rgba(201,168,76,.2)';
      step1Num.style.borderColor = 'rgba(201,168,76,.4)';
      step1Num.style.color = 'var(--gold)';
      step1Label.classList.remove('active');
      step1Label.style.color = 'var(--text-dim)';

      step2Num.classList.add('active');
      step2Num.style.background = isWomen ? 'var(--rose)' : 'var(--gold)';
      step2Num.style.borderColor = isWomen ? 'var(--rose)' : 'var(--gold)';
      step2Num.style.color = isWomen ? '#fff' : '#080808';
      step2Label.classList.add('active');
      step2Label.style.color = isWomen ? 'var(--rose-light)' : 'var(--gold)';

      // Build step 2 content
      var recipientNames = { h: 'Husband, Boyfriend, Father, Brother, Son', w: 'Wife, Girlfriend, Mother, Sister, Daughter' };
      var productNames = { h: 'AUDORA BLACK OUD', w: 'AUDORA ROSE NOIR', c: 'His and Hers Collection' };
      var productTags = { h: 'Gift for Him', w: 'Gift for Her', c: 'His and Hers Collection' };
      var productImgs = {
        h: 'https://cdn.shopify.com/s/files/1/0770/2770/5108/files/IMG_7511.jpg?v=1778620939',
        w: 'https://cdn.shopify.com/s/files/1/0770/2770/5108/files/IMG_7485.jpg?v=1778620938',
        c: 'https://cdn.shopify.com/s/files/1/0770/2770/5108/files/IMG_7513.jpg?v=1778620938'
      };

      var html = '<button onclick="location.reload()" style="display:flex;align-items:center;gap:8px;background:none;border:none;cursor:pointer;font-family:var(--font-sans);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.4);padding:0;margin-bottom:24px;">\u2190 Change recipient</button>';

      html += '<div style="background:var(--dark-card);border-radius:3px;overflow:hidden;margin-bottom:20px;">';
      html += '<img src="' + productImgs[selectedRecipient] + '" alt="" style="width:100%;height:200px;object-fit:cover;">';
      html += '<div style="padding:18px;">';
      html += '<div style="font-size:9px;letter-spacing:2.5px;text-transform:uppercase;font-weight:700;color:' + accentColor + ';margin-bottom:5px;font-family:var(--font-sans);">' + productTags[selectedRecipient] + '</div>';
      html += '<div style="font-family:var(--font-serif);font-size:24px;font-weight:400;color:var(--text);margin-bottom:3px;">' + productNames[selectedRecipient] + '</div>';
      if (isCouple) {
        html += '<div style="font-size:11px;color:rgba(255,255,255,.4);font-family:var(--font-sans);">Perfect for: Anniversary, Valentine\'s Day, Wedding Gift, Couples Birthday</div>';
      } else {
        html += '<div style="font-size:11px;color:rgba(255,255,255,.45);line-height:1.9;font-family:var(--font-sans);">Perfect for your <strong style="color:rgba(255,255,255,.7);">' + recipientNames[selectedRecipient] + '</strong></div>';
      }
      html += '</div></div>';

      if (isCouple) {
        html += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:2px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">';
        html += '<div><div style="font-family:var(--font-serif);font-size:16px;color:var(--text);">AUDORA BLACK OUD</div><div style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);font-family:var(--font-sans);">Men\'s · 50ml</div></div>';
        html += '<div style="font-family:var(--font-serif);font-size:16px;color:rgba(255,255,255,.35);">KSH 2,999</div></div>';
        html += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:2px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">';
        html += '<div><div style="font-family:var(--font-serif);font-size:16px;color:var(--text);">AUDORA ROSE NOIR</div><div style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--rose-light);font-family:var(--font-sans);">Women\'s · 50ml</div></div>';
        html += '<div style="font-family:var(--font-serif);font-size:16px;color:rgba(255,255,255,.35);">KSH 2,999</div></div>';
        html += '<div style="background:rgba(92,184,92,.06);border:1px solid rgba(92,184,92,.2);border-radius:2px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">';
        html += '<span style="font-size:11px;color:var(--green);font-family:var(--font-sans);">Bundle Total · Save KSH 499</span>';
        html += '<span style="font-family:var(--font-serif);font-size:20px;color:var(--gold-light);">KSH 5,499</span></div>';
      } else {
        html += '<div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:' + accentColor + ';margin-bottom:10px;font-family:var(--font-sans);">Select Bundle</div>';
        html += '<div class="gift-bundle-options" style="display:flex;flex-direction:column;gap:9px;margin-bottom:18px;">';
        html += '<div class="gift-bundle-opt" data-bundle="1 Bottle" data-price="KSH 2,999" style="display:flex;background:transparent;border:1px solid rgba(201,168,76,.18);border-radius:3px;padding:13px 14px;cursor:pointer;justify-content:space-between;align-items:center;width:100%;"><div><div style="font-size:13px;font-weight:600;color:var(--text);font-family:var(--font-sans);">1 Bottle</div><div style="font-size:10px;color:#777;font-family:var(--font-sans);">Single bottle gift</div></div><div style="font-family:var(--font-serif);font-size:19px;color:' + accentColor + ';font-weight:400;text-align:right;">KSH 2,999</div></div>';
        html += '<div class="gift-bundle-opt selected" data-bundle="2 Bottles" data-price="KSH 5,499" style="display:flex;border:1px solid ' + borderColor + ';background:' + bgSelected + ';border-radius:3px;padding:13px 14px;cursor:pointer;justify-content:space-between;align-items:center;width:100%;position:relative;"><div style="position:absolute;top:-8px;left:12px;font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:2px 9px;border-radius:2px;background:' + badgeBg + ';color:' + badgeColor + ';font-family:var(--font-sans);">Most Popular</div><div><div style="font-size:13px;font-weight:600;color:var(--text);font-family:var(--font-sans);">2 Bottles</div><div style="font-size:10px;color:#777;font-family:var(--font-sans);">One to give, one to keep</div></div><div><div style="font-family:var(--font-serif);font-size:19px;color:' + accentColor + ';font-weight:400;text-align:right;">KSH 5,499</div><div style="font-size:10px;color:var(--green);text-align:right;font-family:var(--font-sans);">Save KSH 499</div></div></div>';
        html += '<div class="gift-bundle-opt" data-bundle="3 Bottles" data-price="KSH 7,499" style="display:flex;background:transparent;border:1px solid rgba(201,168,76,.18);border-radius:3px;padding:13px 14px;cursor:pointer;justify-content:space-between;align-items:center;width:100%;"><div><div style="font-size:13px;font-weight:600;color:var(--text);font-family:var(--font-sans);">3 Bottles</div><div style="font-size:10px;color:#777;font-family:var(--font-sans);">Best value</div></div><div><div style="font-family:var(--font-serif);font-size:19px;color:' + accentColor + ';font-weight:400;text-align:right;">KSH 7,499</div><div style="font-size:10px;color:var(--green);text-align:right;font-family:var(--font-sans);">Save KSH 1,498</div></div></div>';
        html += '</div>';
      }

      html += '<div style="background:rgba(92,184,92,.07);border:1px solid rgba(92,184,92,.22);border-radius:3px;padding:11px 14px;text-align:center;font-size:11px;color:var(--green);margin-bottom:12px;font-family:var(--font-sans);">Cash On Delivery — You pay only when the order arrives</div>';
      html += '<input class="form-input" id="gift-name" type="text" placeholder="Full Name *">';
      html += '<input class="form-input" id="gift-phone" type="tel" placeholder="Phone Number *">';
      html += '<input class="form-input" id="gift-location" type="text" placeholder="Delivery Location *">';
      html += '<button id="gift-submit" class="btn ' + btnClass + '" style="margin-top:4px;">' + (isCouple ? 'Order His and Hers Bundle — KSH 5,499' : (isWomen ? 'Order ROSE NOIR Gift — Cash On Delivery' : 'Order BLACK OUD Gift — Cash On Delivery')) + '</button>';

      step1Content.style.display = 'none';
      step2Content.style.display = 'block';
      step2Content.innerHTML = html;

      // Attach gift bundle selector
      setTimeout(function() {
        var giftOpts = step2Content.querySelectorAll('.gift-bundle-opt');
        giftOpts.forEach(function(opt) {
          opt.addEventListener('click', function() {
            giftOpts.forEach(function(o) {
              o.classList.remove('selected');
              o.style.borderColor = 'rgba(201,168,76,.18)';
              o.style.background = 'transparent';
            });
            this.classList.add('selected');
            this.style.borderColor = isWomen ? 'var(--rose)' : 'var(--gold)';
            this.style.background = isWomen ? 'rgba(196,137,110,.06)' : 'rgba(201,168,76,.06)';
          });
        });

        var giftSubmit = document.getElementById('gift-submit');
        if (giftSubmit) {
          giftSubmit.addEventListener('click', function() {
            var n = document.getElementById('gift-name').value.trim();
            var p = document.getElementById('gift-phone').value.trim();
            var l = document.getElementById('gift-location').value.trim();
            if (!n || !p || !l) {
              alert('Please fill in all fields.');
              return;
            }
            var sel = step2Content.querySelector('.gift-bundle-opt.selected');
            var bundle = sel ? sel.getAttribute('data-bundle') : (isCouple ? 'His and Hers (2 bottles)' : '2 Bottles');
            var price = sel ? sel.getAttribute('data-price') : 'KSH 5,499';
            var prod = isCouple ? 'His and Hers Bundle (BLACK OUD + ROSE NOIR)' : (isWomen ? 'AUDORA ROSE NOIR — Gift for Her' : 'AUDORA BLACK OUD — Gift for Him');

            var msg = 'Hello AUDORA!\n\nGift Order:\nProduct: ' + prod + '\nBundle: ' + bundle + '\nTotal: ' + price + '\nName: ' + n + '\nPhone: ' + p + '\nLocation: ' + l + '\n\nPlease confirm. Thank you!';
            window.open('https://wa.me/254700000000?text=' + encodeURIComponent(msg), '_blank');
          });
        }

        step2Content.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    });
  }
})();
