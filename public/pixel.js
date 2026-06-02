// Pixel Tracking Manager
(function() {
  'use strict';

  // Configuration
  const PIXELS = {
    facebook: {
      pixelId: '662352908984168',
      accessToken: 'EAALR3XPeeW8BO7XDY9iNaTZCp2dWYCUfuACY5mde4HZCjcZBktcwnaUdgnMRG5FKA99fCUsO5hGl7OuiQxwOOYMvIlMZBT149ZBODEER8M25XchOupLmfxZCI7alsdcYCBIMyhqYBudBORAZBDuYZCd8dl9g0yCPrTMjMuWgzfY5z5XoUzTky0VrWUFwi8RcZCtBMLwZDZD'
    },
    tiktok: {
      pixelId: 'CUPL27RC77UAVCG300J0',
      accessToken: 'c2cd463f77fbb4e0d28950a952214bee030c1e41'
    },
    googleAds: {
      tagId: 'AW-884250671',
      purchaseLabel: 'zvrACKjjqpQZEK-w0qUD'
    },
    snapchat: {
      pixelId: '17729cce-5644-4998-9ca6-139a34fb66a7'
    }
  };

  // WhatsApp number
  window.WHATSAPP_NUMBER = '+971523012934';

  // Initialize Facebook Pixel
  if (PIXELS.facebook.pixelId) {
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', PIXELS.facebook.pixelId);
    fbq('track', 'PageView');
  }

  // Initialize TikTok Pixel
  if (PIXELS.tiktok.pixelId) {
    !function (w, d, t) {
      w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
      ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
      ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
      for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
      ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
      ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";
      ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},
      ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};
      var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;
      var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
      ttq.load(PIXELS.tiktok.pixelId);
    }(window, document, 'ttq');
  }

  // Initialize Google Ads
  if (PIXELS.googleAds.tagId) {
    const script = document.createElement('script');
    script.src = `https://www.googletagmanager.com/gtag/js?id=${PIXELS.googleAds.tagId}`;
    script.async = true;
    document.head.appendChild(script);
    
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', PIXELS.googleAds.tagId);
    window.gtag = gtag;
  }

  // Initialize Snapchat Pixel
  if (PIXELS.snapchat.pixelId) {
    (function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function()
    {a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};
    a.queue=[];var s='script';r=t.createElement(s);
    r.async=!0;r.src=n;var u=t.getElementsByTagName(s)[0];
    u.parentNode.insertBefore(r,u);})(window,document,
    'https://sc-static.net/scevent.min.js');
    
    snaptr('init', PIXELS.snapchat.pixelId, {
      'user_email': '__INSERT_USER_EMAIL__'
    });
    snaptr('track', 'PAGE_VIEW');
  }

  // Track event function
  window.trackEvent = function(eventName, data) {
    console.log('[Pixel] Tracking:', eventName, data);

    // Facebook
    if (typeof fbq !== 'undefined') {
      fbq('track', eventName, data);
    }

    // TikTok
    if (typeof ttq !== 'undefined') {
      ttq.track(eventName, data);
    }

    // Google Ads
    if (typeof gtag !== 'undefined') {
      gtag('event', eventName, data);
    }

    // Snapchat
    if (typeof snaptr !== 'undefined') {
      snaptr('track', eventName, data);
    }

    // Send to backend
    fetch('/api/track-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: eventName, data })
    }).catch(console.error);
  };

  // Get URL parameters
  window.getUrlParam = function(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
  };

  // Track source on page load
  const source = getUrlParam('utm_source') || 
                 getUrlParam('source') || 
                 document.referrer.includes('facebook.com') ? 'Facebook' :
                 document.referrer.includes('instagram.com') ? 'Instagram' :
                 document.referrer.includes('youtube.com') ? 'YouTube' :
                 document.referrer.includes('tiktok.com') ? 'TikTok' :
                 document.referrer.includes('snapchat.com') ? 'Snapchat' :
                 'Direct';

  window.trafficSource = source;
  if (source !== 'Direct') {
    trackEvent('SourceAttribution', { source });
  }

  // Store source for later use
  sessionStorage.setItem('trafficSource', source);

})();
