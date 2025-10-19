/* Packed, MathJax-aware PDF generator:
   - Extra spacing between boxes
   - Never splits a box across pages (page breaks occur only between cards)
*/

(function () {
    class LatexPDFGenerator {
      constructor(opts = {}) {
        this.options = Object.assign(
          {
            pdfUnit: "pt",
            pdfFormat: "a4",
            pdfOrientation: "p",
            filename: "extracted.pdf",
  
            // Rendering / layout
            rasterScale: 2.8,          // higher = sharper; adjust if files get too large
            pageMarginPt: 28,          // ~0.39in margins
            contentWidthPx: 820,       // layout width (px) for offscreen render
            blockSpacingPx: 24,        // EXTRA spacing between boxes (was 12)
  
            // Visual accents (purely cosmetic)
            colorMap: {
              definition: "#E8EDFF",
              lemma: "#E8FFF3",
              theorem: "#FFF5E6",
              proposition: "#FFF0F5",
              corollary: "#F0FFF4",
              remark: "#F7FAFC",
              claim: "#F9FAFB",
              axiom: "#E6F7FF",
            },
          },
          opts
        );
  
        const { jsPDF } = window.jspdf || {};
        if (!jsPDF) throw new Error("jsPDF is not loaded.");
        if (typeof html2canvas !== "function") throw new Error("html2canvas is not loaded.");
  
        this.jsPDF = jsPDF;
  
        // Off-screen render host
        this.renderHost = document.getElementById("pdfRenderContainer");
        if (!this.renderHost) {
          this.renderHost = document.createElement("div");
          this.renderHost.id = "pdfRenderContainer";
          this.renderHost.style.cssText =
            "position:absolute;left:-9999px;top:0;background:white;";
          document.body.appendChild(this.renderHost);
        }
      }
  
      /**
       * Public: generate a single PDF with ALL items packed together (no wasted space),
       * extra spacing, and NO card split across pages.
       */
      async generatePDF(items) {
        if (!Array.isArray(items) || items.length === 0) {
          throw new Error("No items to export.");
        }
  
        // Build continuous DOM doc with all cards
        const { wrapper, cards } = await this._buildContinuousDocument(items);
  
        // Typeset all math first
        await this._typeset(wrapper);
        await new Promise((r) => setTimeout(r, 120)); // let layout settle
  
        // Render one big canvas of the full wrapper
        const bigCanvas = await html2canvas(wrapper, {
          backgroundColor: "#ffffff",
          scale: this.options.rasterScale,
          useCORS: true,
          imageTimeout: 0,
          logging: false,
        });
  
        // Compute page slices that BREAK ONLY BETWEEN CARDS
        const slices = this._computePageSlices(wrapper, cards, bigCanvas);
  
        // Remove DOM wrapper
        this.renderHost.removeChild(wrapper);
  
        // Assemble PDF using the computed slices
        await this._buildPdfFromSlices(bigCanvas, slices);
      }
  
      /**
       * Build one off-screen wrapper that contains ALL items stacked consecutively
       * with extra spacing. Returns the wrapper AND a list of card DOM nodes for pagination.
       */
      async _buildContinuousDocument(items) {
        const wrapper = document.createElement("div");
        wrapper.style.cssText = `
          width:${this.options.contentWidthPx}px;
          box-sizing:border-box;
          padding:0;
          margin:0;
          background:white;
          font-family: 'Georgia','Times New Roman',Times,serif;
          color:#2d3748;
        `;
  
        const cards = [];
  
        for (let i = 0; i < items.length; i++) {
          const card = this._buildItemCard(items[i], i);
          if (i > 0) card.style.marginTop = `${this.options.blockSpacingPx}px`;
          wrapper.appendChild(card);
          cards.push(card);
        }
  
        this.renderHost.appendChild(wrapper);
        return { wrapper, cards };
      }
  
      /**
       * Build a single “card” (box). Content inserted via textContent — no LaTeX mutation.
       */
      _buildItemCard(item, index) {
        const type = String(item.type || "definition").toLowerCase();
        const bg = this.options.colorMap[type] || this.options.colorMap.definition;
  
        const card = document.createElement("div");
        card.style.cssText = `
          box-sizing:border-box;
          background:${bg};
          padding:16px 18px;
          border-radius:10px;
          border-left:5px solid #667eea;
          line-height:1.75;
          box-shadow: 0 1px 2px rgba(0,0,0,0.06);
        `;
  
        const header = document.createElement("div");
        header.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:10px;";
  
        const badge = document.createElement("div");
        badge.textContent = item.type || "Item";
        badge.style.cssText = `
          display:inline-block;background:#667eea;color:white;padding:4px 10px;border-radius:5px;
          font-size:11px;font-weight:700;text-transform:uppercase;
          font-family:system-ui,-apple-system,sans-serif;
        `;
  
        const title = document.createElement("div");
        title.textContent = item.title || `${item.type || "Item"} ${index + 1}`;
        title.style.cssText = `
          font-size:16px;font-weight:700;color:#2d3748;
          font-family:system-ui,-apple-system,sans-serif;
        `;
  
        header.appendChild(badge);
        header.appendChild(title);
        card.appendChild(header);
  
        const content = document.createElement("div");
        content.className = "content-text";
        content.style.cssText = `
          font-size:15px;line-height:1.85;color:#2d3748;
          white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;
        `;
        content.textContent = item.content || "";
        card.appendChild(content);
  
        if (item.page != null) {
          const meta = document.createElement("div");
          meta.textContent = `Source page: ${item.page}`;
          meta.style.cssText = `
            margin-top:10px;font-size:11px;color:#718096;
            font-family:system-ui,-apple-system,sans-serif;
          `;
          card.appendChild(meta);
        }
  
        return card;
      }
  
      /**
       * Decide where page breaks should occur so that no card is split.
       * We compute each card's top/height in DOM px, scale to canvas px,
       * then pack cards into page slices within the available page height.
       */
      _computePageSlices(wrapper, cards, bigCanvas) {
        // PDF geometry (pt)
        const pdf = new this.jsPDF({
          unit: this.options.pdfUnit,
          format: this.options.pdfFormat,
          orientation: this.options.pdfOrientation,
        });
        const pageWidthPt = pdf.internal.pageSize.getWidth();
        const pageHeightPt = pdf.internal.pageSize.getHeight();
        const margin = this.options.pageMarginPt;
        const usableWidthPt = pageWidthPt - 2 * margin;
        const usableHeightPt = pageHeightPt - 2 * margin;
  
        // Map DOM px to PDF pt via the rasterized canvas
        const pxToPt = usableWidthPt / bigCanvas.width;
        const pageSliceHeightPx = Math.floor(usableHeightPt / pxToPt);
  
        // Build an array of card rectangles in CANVAS pixels
        const wrapperTop = wrapper.getBoundingClientRect().top;
        const cardRectsPx = cards.map((el) => {
          const r = el.getBoundingClientRect();
          const topPx = (r.top - wrapperTop) + wrapper.scrollTop; // relative to wrapper
          const heightPx = r.height;
          return {
            topPx: Math.round(topPx * this.options.rasterScale),
            heightPx: Math.round(heightPx * this.options.rasterScale),
          };
        });
  
        // Pack cards into page slices:
        // each slice is [yStartPx, yEndPx] in CANVAS pixels,
        // and boundaries align with card bottoms so no card is cut.
        const slices = [];
        let pageStartPx = 0;          // canvas y start for current page
        let usedPx = 0;               // used height on current page in *PDF* usable area, but in CANVAS px
        let currentIndex = 0;
  
        while (currentIndex < cardRectsPx.length) {
          usedPx = 0;
          const pageMaxPx = pageSliceHeightPx; // capacity per page in canvas px
  
          let lastCardBottomPx = pageStartPx;
          while (currentIndex < cardRectsPx.length) {
            const c = cardRectsPx[currentIndex];
            const cardTopPx = c.topPx;
            const cardBottomPx = c.topPx + c.heightPx;
  
            // If this is the very first card on this page, align pageStart with its top
            if (usedPx === 0) {
              pageStartPx = cardTopPx;
            }
  
            const nextUsedPx = (cardBottomPx - pageStartPx);
  
            if (nextUsedPx <= pageMaxPx) {
              // fits on this page
              usedPx = nextUsedPx;
              lastCardBottomPx = cardBottomPx;
              currentIndex += 1;
            } else {
              // doesn't fit; close current page BEFORE this card
              break;
            }
          }
  
          // Push slice for this page (only if we placed at least one card)
          if (usedPx > 0) {
            slices.push({
              yStartPx: pageStartPx,
              yEndPx: lastCardBottomPx,
              usableWidthPt,
              pxToPt,
              margin,
              usableHeightPt,
            });
            // Next page starts at lastCardBottomPx
            pageStartPx = lastCardBottomPx;
          } else {
            // Safety: if single card is taller than a page (rare), fall back to forced slice
            const c = cardRectsPx[currentIndex];
            slices.push({
              yStartPx: c.topPx,
              yEndPx: c.topPx + Math.min(c.heightPx, pageSliceHeightPx),
              usableWidthPt,
              pxToPt,
              margin,
              usableHeightPt,
            });
            currentIndex += 1;
            pageStartPx = slices[slices.length - 1].yEndPx;
          }
        }
  
        return slices;
      }
  
      /**
       * Convert the canvas slices into PDF pages.
       */
      async _buildPdfFromSlices(bigCanvas, slices) {
        const pdf = new this.jsPDF({
          unit: this.options.pdfUnit,
          format: this.options.pdfFormat,
          orientation: this.options.pdfOrientation,
          compress: true,
        });
  
        let first = true;
  
        for (const slice of slices) {
          const {
            yStartPx,
            yEndPx,
            usableWidthPt,
            pxToPt,
            margin,
          } = slice;
  
          const sliceHeightPx = yEndPx - yStartPx;
          const sliceHeightPt = sliceHeightPx * pxToPt;
  
          // Create an image from the slice (no card is cut)
          const sliceCanvas = document.createElement("canvas");
          sliceCanvas.width = bigCanvas.width;
          sliceCanvas.height = sliceHeightPx;
  
          const ctx = sliceCanvas.getContext("2d");
          ctx.drawImage(
            bigCanvas,
            0,
            yStartPx,
            bigCanvas.width,
            sliceHeightPx,
            0,
            0,
            bigCanvas.width,
            sliceHeightPx
          );
  
          const img = sliceCanvas.toDataURL("image/png");
  
          if (!first) pdf.addPage();
          first = false;
  
          pdf.addImage(
            img,
            "PNG",
            margin,
            margin,
            usableWidthPt,
            sliceHeightPt,
            undefined,
            "FAST"
          );
        }
  
        pdf.save(this.options.filename);
      }
  
      async _typeset(node) {
        if (!window.MathJax) return;
        if (window.MathJax.typesetPromise) {
          await window.MathJax.typesetPromise([node]);
        } else if (window.MathJax.Hub) {
          await new Promise((res) => {
            window.MathJax.Hub.Queue(["Typeset", window.MathJax.Hub, node]);
            window.MathJax.Hub.Queue(res);
          });
        }
      }
    }
  
    // Expose
    window.LatexPDFGenerator = LatexPDFGenerator;
  })();
  