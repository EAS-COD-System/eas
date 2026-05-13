(function() {
  var r = document.getElementById('aud');
  if (!r) return;

  // ----- Common intersection observer for .rv elements -----
  var io = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) entry.target.classList.add('vis');
    });
  }, { threshold: 0.1 });
  r.querySelectorAll('.rv').forEach(function(el) { io.observe(el); });

  // ----- FAQ accordion -----
  r.querySelectorAll('.fqq').forEach(function(q) {
    q.addEventListener('click', function() {
      var i = this.parentElement;
      var open = i.classList.contains('open');
      r.querySelectorAll('.fqi').forEach(function(x) { x.classList.remove('open'); });
      if (!open) i.classList.add('open');
    });
  });

  // ----- Bundle option selector (both Men and Women pages) -----
  r.querySelectorAll('.bopts').forEach(function(bopts) {
    bopts.querySelectorAll('.bo').forEach(function(b) {
      b.addEventListener('click', function() {
        bopts.querySelectorAll('.bo').forEach(function(x) { x.classList.remove('sel'); });
        this.classList.add('sel');
      });
    });
  });

  // ----- Sticky bar toggle (Men & Women pages) -----
  var hero = r.querySelector('.hero');
  var sticky = r.querySelector('.sticky');
  if (hero && sticky) {
    window.addEventListener('scroll', function() {
      sticky.style.display = hero.getBoundingClientRect().bottom < 0 ? 'flex' : 'none';
    });
  }

  // ----- Men / Women order button (WhatsApp) -----
  var orderBtn = r.querySelector('.osb');
  if (orderBtn) {
    orderBtn.addEventListener('click', function(e) {
      e.preventDefault();
      var n = r.querySelector('#fn').value.trim();
      var p = r.querySelector('#fp').value.trim();
      var l = r.querySelector('#fl').value.trim();
      var s = r.querySelector('.bo.sel');
      var b = s ? s.querySelector('.bol').textContent : '2 Bottles';
      var pr = s ? s.querySelector('.bpr').textContent : 'KSH 5,499';

      // Detect if we're on the Women's page by checking for .rose class
      var isWomen = r.classList.contains('rose');
      var prod = isWomen ? 'AUDORA ROSE NOIR — Women\'s Fragrance' : 'AUDORA BLACK OUD — Men\'s Fragrance';

      if (!n || !p || !l) {
        alert('Please fill in your name, phone and location.');
        return;
      }

      var msg = 'Hello AUDORA!\n\nOrder:\nProduct: ' + prod + '\nBundle: ' + b + '\nTotal: ' + pr + '\nName: ' + n + '\nPhone: ' + p + '\nLocation: ' + l + '\n\nPlease confirm. Thank you!';
      // REPLACE 254700000000 WITH YOUR REAL WHATSAPP NUMBER
      window.open('https://wa.me/254700000000?text=' + encodeURIComponent(msg), '_blank');
    });
  }

  // ----- Sticky bar button (Men & Women pages) -----
  var skb = r.querySelector('#skb');
  if (skb) {
    skb.addEventListener('click', function() {
      var ao = r.querySelector('#ao');
      if (ao) ao.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ===== GIFT PAGE LOGIC (only runs if #gm exists) =====
  if (document.getElementById('gm')) {
    var sw = null;
    var IM = {
      h: 'https://cdn.shopify.com/s/files/1/0770/2770/5108/files/IMG_7511.jpg?v=1778620939',
      w: 'https://cdn.shopify.com/s/files/1/0770/2770/5108/files/IMG_7485.jpg?v=1778620938',
      c: 'https://cdn.shopify.com/s/files/1/0770/2770/5108/files/IMG_7513.jpg?v=1778620938'
    };
    var NM = { h: 'AUDORA BLACK OUD', w: 'AUDORA ROSE NOIR', c: 'His and Hers Collection' };
    var FR = { h: 'Husband, Boyfriend, Father, Brother, Son', w: 'Wife, Girlfriend, Mother, Sister, Daughter' };
    var TY = { h: "Men's Fragrance · 50ml", w: "Women's Fragrance · 50ml" };
    var CL = { h: '#c9a84c', w: '#d9a88e', c: '#c9a84c' };
    var PR = { h: 'AUDORA BLACK OUD — Gift for Him', w: 'AUDORA ROSE NOIR — Gift for Her', c: 'His and Hers Bundle (BLACK OUD + ROSE NOIR)' };

    window.gSel = function(w) {
      sw = w;
      ['h','w','c'].forEach(function(k) {
        var b = document.getElementById('gb'+k);
        var c = document.getElementById('gc'+k);
        if (k === w) {
          b.style.borderColor = (k === 'w' ? '#c4896e' : '#c9a84c');
          b.style.background = (k === 'w' ? 'rgba(196,137,110,.06)' : 'rgba(201,168,76,.06)');
          if (c) c.style.display = 'flex';
        } else {
          b.style.borderColor = 'rgba(255,255,255,.1)';
          b.style.background = '#1a1a1a';
          if (c) c.style.display = 'none';
        }
      });
      var pb = document.getElementById('gpb');
      pb.style.display = 'block';
      if (w === 'w') {
        pb.style.background = 'linear-gradient(135deg,#a8674f,#c4896e 30%,#d9a88e 60%,#c4896e 80%,#a8674f)';
        pb.style.color = '#fff';
      } else {
        pb.style.background = 'linear-gradient(135deg,#b8912e,#c9a84c 30%,#e2c27d 60%,#c9a84c 80%,#b8912e)';
        pb.style.color = '#080808';
      }
    };

    window.gStep2 = function() {
      if (!sw) return;
      var c = (sw === 'w');
      var ic = (sw === 'c');
      var prC = c ? '#d9a88e' : '#e2c27d';
      var btnS = c ? 'background:linear-gradient(135deg,#a8674f,#c4896e 30%,#d9a88e 60%,#c4896e 80%,#a8674f);color:#fff' : 'background:linear-gradient(135deg,#b8912e,#c9a84c 30%,#e2c27d 60%,#c9a84c 80%,#b8912e);color:#080808';
      var sel = ic ? 'border-color:#c9a84c;background:rgba(201,168,76,.06)' : (c ? 'border-color:#c4896e;background:rgba(196,137,110,.06)' : 'border-color:#c9a84c;background:rgba(201,168,76,.06)');
      var pbgs = ic ? 'background:#c9a84c;color:#080808' : (c ? 'background:#c4896e;color:#fff' : 'background:#c9a84c;color:#080808');

      document.getElementById('gsn1').style.cssText = 'width:28px;height:28px;border-radius:50%;border:1px solid rgba(201,168,76,.4);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:rgba(201,168,76,.2);color:#c9a84c;font-family:Montserrat,sans-serif;';
      document.getElementById('gsn2').style.cssText = 'width:28px;height:28px;border-radius:50%;border:1px solid ' + CL[sw] + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:' + CL[sw] + ';color:' + (c ? '#fff' : '#080808') + ';font-family:Montserrat,sans-serif;';
      document.getElementById('gsl2').style.color = CL[sw];

      var backBtn = '<button onclick="gBack()" style="display:flex;align-items:center;gap:8px;background:none;border:none;cursor:pointer;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.4);padding:0;margin-bottom:24px;">← Change recipient</button>';

      var summ = '<div style="background:#1a1a1a;border-radius:3px;overflow:hidden;margin-bottom:20px;"><img src="' + IM[sw] + '" alt="" style="width:100%;height:200px;object-fit:cover;display:block;max-height:none;"><div style="padding:18px;"><div style="font-size:9px;letter-spacing:2.5px;text-transform:uppercase;font-weight:700;color:' + CL[sw] + ';margin-bottom:5px;font-family:Montserrat,sans-serif;">' + (ic ? 'His and Hers Collection' : (c ? 'Gift for Her' : 'Gift for Him')) + '</div><div style="font-family:Cormorant Garamond,serif;font-size:24px;font-weight:400;color:#fff;margin-bottom:3px;">' + NM[sw] + '</div>' + (ic ? '<div style="font-size:11px;color:rgba(255,255,255,.4);font-family:Montserrat,sans-serif;">Perfect for: Anniversary, Valentine\'s Day, Wedding Gift, Couples Birthday</div>' : '<div style="font-size:11px;color:rgba(255,255,255,.45);line-height:1.9;font-family:Montserrat,sans-serif;">Perfect for your <strong style="color:rgba(255,255,255,.7);">' + FR[sw] + '</strong></div>') + '</div></div>';

      var coupleItems = '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:2px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;"><div><div style="font-family:Cormorant Garamond,serif;font-size:16px;color:#fff;">AUDORA BLACK OUD</div><div style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#c9a84c;font-family:Montserrat,sans-serif;">Men\'s · 50ml</div></div><div style="font-family:Cormorant Garamond,serif;font-size:16px;color:rgba(255,255,255,.35);">KSH 2,999</div></div><div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:2px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;"><div><div style="font-family:Cormorant Garamond,serif;font-size:16px;color:#fff;">AUDORA ROSE NOIR</div><div style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#d9a88e;font-family:Montserrat,sans-serif;">Women\'s · 50ml</div></div><div style="font-family:Cormorant Garamond,serif;font-size:16px;color:rgba(255,255,255,.35);">KSH 2,999</div></div><div style="background:rgba(92,184,92,.06);border:1px solid rgba(92,184,92,.2);border-radius:2px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;"><span style="font-size:11px;color:#5cb85c;font-family:Montserrat,sans-serif;">Bundle Total · Save KSH 499</span><span style="font-family:Cormorant Garamond,serif;font-size:20px;color:#e2c27d;">KSH 5,499</span></div>';

      var buns = ic ? coupleItems : '<div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:' + CL[sw] + ';margin-bottom:10px;font-family:Montserrat,sans-serif;">Select Bundle</div><div class="gbopts" style="display:flex;flex-direction:column;gap:9px;margin-bottom:18px;"><div onclick="gSelB(this)" style="display:flex;background:transparent;border:1px solid rgba(201,168,76,.18);border-radius:3px;padding:13px 14px;cursor:pointer;justify-content:space-between;align-items:center;width:100%;"><div><div style="font-size:13px;font-weight:600;color:#fff;font-family:Montserrat,sans-serif;display:block;">1 Bottle</div><div style="font-size:10px;color:#777;font-family:Montserrat,sans-serif;display:block;">Single bottle gift</div></div><div style="font-family:Cormorant Garamond,serif;font-size:19px;color:' + prC + ';font-weight:400;text-align:right;">KSH 2,999</div></div><div onclick="gSelB(this)" class="gsel" style="display:flex;' + sel + ';border-radius:3px;padding:13px 14px;cursor:pointer;justify-content:space-between;align-items:center;width:100%;position:relative;"><div style="position:absolute;top:-8px;left:12px;font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:2px 9px;border-radius:2px;' + pbgs + ';font-family:Montserrat,sans-serif;">Most Popular</div><div><div style="font-size:13px;font-weight:600;color:#fff;font-family:Montserrat,sans-serif;display:block;">2 Bottles</div><div style="font-size:10px;color:#777;font-family:Montserrat,sans-serif;display:block;">One to give, one to keep</div></div><div><div style="font-family:Cormorant Garamond,serif;font-size:19px;color:' + prC + ';font-weight:400;text-align:right;">KSH 5,499</div><div style="font-size:10px;color:#5cb85c;text-align:right;font-family:Montserrat,sans-serif;">Save KSH 499</div></div></div><div onclick="gSelB(this)" style="display:flex;background:transparent;border:1px solid rgba(201,168,76,.18);border-radius:3px;padding:13px 14px;cursor:pointer;justify-content:space-between;align-items:center;width:100%;"><div><div style="font-size:13px;font-weight:600;color:#fff;font-family:Montserrat,sans-serif;display:block;">3 Bottles</div><div style="font-size:10px;color:#777;font-family:Montserrat,sans-serif;display:block;">Best value</div></div><div><div style="font-family:Cormorant Garamond,serif;font-size:19px;color:' + prC + ';font-weight:400;text-align:right;">KSH 7,499</div><div style="font-size:10px;color:#5cb85c;text-align:right;font-family:Montserrat,sans-serif;">Save KSH 1,498</div></div></div>';

      var btnTxt = ic ? 'Order His and Hers Bundle — KSH 5,499' : (c ? 'Order ROSE NOIR Gift' : 'Order BLACK OUD Gift') + ' — Cash On Delivery';
      var form = '<div style="background:rgba(92,184,92,.07);border:1px solid rgba(92,184,92,.22);border-radius:3px;padding:11px 14px;text-align:center;font-size:11px;color:#5cb85c;margin-bottom:12px;font-family:Montserrat,sans-serif;">Cash On Delivery — You pay only when the order arrives</div><input class="ff" id="fn" type="text" placeholder="Full Name *"><input class="ff" id="fp" type="tel" placeholder="Phone Number *"><input class="ff" id="fl" type="text" placeholder="Delivery Location *"><button onclick="gSub()" style="display:block;width:100%;padding:16px 24px;' + btnS + ';font-family:Montserrat,sans-serif;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;text-align:center;border:none;border-radius:2px;cursor:pointer;margin-top:4px;">' + btnTxt + '</button>';

      document.getElementById('gs1').style.display = 'none';
      var s2 = document.getElementById('gs2');
      s2.style.display = 'block';
      s2.innerHTML = backBtn + summ + buns + form;
      setTimeout(function() { s2.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
    };

    window.gBack = function() {
      document.getElementById('gs1').style.display = 'block';
      var s2 = document.getElementById('gs2');
      s2.style.display = 'none';
      s2.innerHTML = '';
      document.getElementById('gsn1').style.cssText = 'width:28px;height:28px;border-radius:50%;border:1px solid #c9a84c;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:#c9a84c;color:#080808;font-family:Montserrat,sans-serif;';
      document.getElementById('gsn2').style.cssText = 'width:28px;height:28px;border-radius:50%;border:1px solid rgba(201,168,76,.3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:rgba(255,255,255,.3);font-family:Montserrat,sans-serif;';
      document.getElementById('gsl2').style.color = 'rgba(255,255,255,.3)';
      document.getElementById('gs1').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    window.gSelB = function(el) {
      var gbopts = el.closest('.gbopts');
      gbopts.querySelectorAll('div[onclick]').forEach(function(b) {
        b.classList.remove('gsel');
        b.style.borderColor = 'rgba(201,168,76,.18)';
        b.style.background = 'transparent';
      });
      if (sw === 'w') {
        el.style.borderColor = '#c4896e';
        el.style.background = 'rgba(196,137,110,.06)';
      } else {
        el.style.borderColor = '#c9a84c';
        el.style.background = 'rgba(201,168,76,.06)';
      }
      el.classList.add('gsel');
    };

    window.gSub = function() {
      var n = document.getElementById('fn') && document.getElementById('fn').value.trim();
      var p = document.getElementById('fp') && document.getElementById('fp').value.trim();
      var l = document.getElementById('fl') && document.getElementById('fl').value.trim();
      if (!n || !p || !l) { alert('Please fill in your name, phone and delivery location.'); return; }
      var bundle, price, prod;
      if (sw === 'c') { bundle = 'His and Hers (2 bottles)'; price = 'KSH 5,499'; prod = PR.c; }
      else {
        var s = document.querySelector('.gsel');
        bundle = s ? s.querySelector('div div:first-child').textContent : '2 Bottles';
        price = s ? s.querySelector('[style*="Cormorant"]').textContent : 'KSH 5,499';
        prod = PR[sw];
      }
      var msg = 'Hello AUDORA!\n\nGift Order:\nProduct: ' + prod + '\nBundle: ' + bundle + '\nTotal: ' + price + '\nName: ' + n + '\nPhone: ' + p + '\nLocation: ' + l + '\n\nPlease confirm. Thank you!';
      // REPLACE 254700000000 WITH YOUR REAL WHATSAPP NUMBER
      window.open('https://wa.me/254700000000?text=' + encodeURIComponent(msg), '_blank');
    };
  }
})();
