/* global _gaq: true, ga: true */

var newUid = require("./lib/uniqueid.js")

var on = require("./lib/events/on.js")
// var off = require("./lib/events/on.js")
var trigger = require("./lib/events/trigger.js")

var Pjax = function(options) {
    this.firstrun = true

    this.options = options
    this.options.elements = this.options.elements || "a[href], form[action]"
    this.options.selectors = this.options.selectors || ["title", ".js-Pjax"]
    this.options.switches = this.options.switches || {}
    this.options.switchesOptions = this.options.switchesOptions || {}
    this.options.history = this.options.history || true
    this.options.analytics = this.options.analytics || function(options) {
      // options.backward or options.foward can be true or undefined
      // by default, we do track back/foward hit
      // https://productforums.google.com/forum/#!topic/analytics/WVwMDjLhXYk
      if (window._gaq) {
        _gaq.push(["_trackPageview"])
      }
      if (window.ga) {
        ga("send", "pageview", {page: options.url, title: options.title})
      }
    }
    this.options.scrollTo = this.options.scrollTo || 0
    this.options.debug = this.options.debug || false

    this.maxUid = this.lastUid = newUid()

    // we can’t replace body.outerHTML or head.outerHTML
    // it create a bug where new body or new head are created in the dom
    // if you set head.outerHTML, a new body tag is appended, so the dom get 2 body
    // & it break the switchFallback which replace head & body
    if (!this.options.switches.head) {
      this.options.switches.head = this.switchElementsAlt
    }
    if (!this.options.switches.body) {
      this.options.switches.body = this.switchElementsAlt
    }

    this.log("Pjax options", this.options)

    if (typeof options.analytics !== "function") {
      options.analytics = function() {}
    }

    this.parseDOM(document)

    on(window, "popstate", function(st) {
      if (st.state) {
        var opt = Pjax.clone(this.options)
        opt.url = st.state.url
        opt.title = st.state.title
        opt.history = false

        if (st.state.uid < this.lastUid) {
          opt.backward = true
        }
        else {
          opt.forward = true
        }
        this.lastUid = st.state.uid

        // @todo implement history cache here, based on uid
        this.loadUrl(st.state.url, opt)
      }
    }.bind(this))
  }

Pjax.prototype = {
  log: require("./lib/proto/log.js"),

  getElements: require("./lib/proto/get-elements.js"),

  parseDOM: require("./lib/proto/parse-dom.js"),

  attachLink: require("./lib/proto/attach-link.js"),

  forEachSelectors: function(cb, context, DOMcontext) {
    return require("./lib/foreach-selectors.js")(this.options.selectors, cb, context, DOMcontext)
  },

  switchSelectors: function(selectors, fromEl, toEl, options) {
    return require("./lib/switch-selectors.js")(this.options.switches, this.options.switchesOptions, selectors, fromEl, toEl, options)
  },

  // too much problem with the code below
  // + it’s too dangerous
//   switchFallback: function(fromEl, toEl) {
//     this.switchSelectors(["head", "body"], fromEl, toEl)
//     // execute script when DOM is like it should be
//     Pjax.executeScripts(document.querySelector("head"))
//     Pjax.executeScripts(document.querySelector("body"))
//   }

  latestChance: function(href) {
    window.location = href
  },

  onSwitch: function() {
    trigger(window, "resize scroll")
  },

  loadContent: function(html, options) {
    var tmpEl = document.implementation.createHTMLDocument()

    // parse HTML attributes to copy them
    // since we are forced to use documentElement.innerHTML (outerHTML can't be used for <html>)
    var htmlRegex = /<html[^>]+>/gi
    var htmlAttribsRegex = /\s?[a-z:]+(?:\=(?:\'|\")[^\'\">]+(?:\'|\"))*/gi
    var matches = html.match(htmlRegex)
    if (matches && matches.length) {
      matches = matches[0].match(htmlAttribsRegex)
      if (matches.length) {
        matches.shift()
        matches.forEach(function(htmlAttrib) {
          var attr = htmlAttrib.trim().split("=")
          tmpEl.documentElement.setAttribute(attr[0], attr[1].slice(1, -1))
        })
      }
    }

    tmpEl.documentElement.innerHTML = html
    this.log("load content", tmpEl.documentElement.attributes, tmpEl.documentElement.innerHTML.length)

    // Clear out any focused controls before inserting new page contents.
    // we clear focus on non form elements
    if (document.activeElement && !document.activeElement.value) {
      try {
        document.activeElement.blur()
      } catch (e) { }
    }

    // try {
    this.switchSelectors(this.options.selectors, tmpEl, document, options)

    // FF bug: Won’t autofocus fields that are inserted via JS.
    // This behavior is incorrect. So if theres no current focus, autofocus
    // the last field.
    //
    // http://www.w3.org/html/wg/drafts/html/master/forms.html
    var autofocusEl = Array.prototype.slice.call(document.querySelectorAll("[autofocus]")).pop()
    if (autofocusEl && document.activeElement !== autofocusEl) {
      autofocusEl.focus();
    }

    // execute scripts when DOM have been completely updated
    this.options.selectors.forEach(function(selector) {
      Pjax.forEachEls(document.querySelectorAll(selector), function(el) {
        Pjax.executeScripts(el)
      })
    })
    // }
    // catch(e) {
    //   if (this.options.debug) {
    //     this.log("Pjax switch fail: ", e)
    //   }
    //   this.switchFallback(tmpEl, document)
    // }
  },

  doRequest: require("./lib/request.js"),

  loadUrl: function(href, options) {
    this.log("load href", href, options)

    trigger(document, "pjax:send", options);

    // Do the request
    this.doRequest(href, function(html) {
      // Fail if unable to load HTML via AJAX
      if (html === false) {
        trigger(document,"pjax:complete pjax:error", options)

        return
      }

      // Clear out any focused controls before inserting new page contents.
      document.activeElement.blur()

      try {
        this.loadContent(html, options)
      }
      catch (e) {
        if (!this.options.debug) {
          if (console && console.error) {
            console.error("Pjax switch fail: ", e)
          }
          this.latestChance(href)
          return
        }
        else {
          throw e
        }
      }

      if (options.history) {
        if (this.firstrun) {
          this.lastUid = this.maxUid = newUid()
          this.firstrun = false
          window.history.replaceState({
            url: window.location.href,
            title: document.title,
            uid: this.maxUid
          },
          document.title)
        }

        // Update browser history
        this.lastUid = this.maxUid = newUid()
        window.history.pushState({
          url: href,
          title: options.title,
          uid: this.maxUid
        },
          options.title,
          href)
      }

      this.forEachSelectors(function(el) {
        this.parseDOM(el)
      }, this)

      // Fire Events
      trigger(document,"pjax:complete pjax:success", options)

      options.analytics()

      // Scroll page to top on new page load
      if (options.scrollTo !== false) {
        if (options.scrollTo.length > 1) {
          window.scrollTo(options.scrollTo[0], options.scrollTo[1])
        }
        else {
          window.scrollTo(0, options.scrollTo)
        }
      }
    }.bind(this))
  }
}

if (Pjax.isSupported()) {
  module.exports = Pjax
}
// if there isn’t required browser functions, returning stupid api
else {
  var stupidPjax = function() {}
  for (var key in Pjax.prototype) {
    if (Pjax.prototype.hasOwnProperty(key) && typeof Pjax.prototype[key] === "function") {
      stupidPjax[key] = stupidPjax
    }
  }

  module.exports = stupidPjax
}
