(function () {
    class LatexPDFGenerator {
      constructor(opts = {}) {
        this.options = Object.assign(
          {
            pdfUnit: "pt",
            pdfFormat: "a4",
            pdfOrientation: "p",
            filename: "extracted.pdf",
  
            rasterScale: 2.8,
            pageMarginPt: 28, 
            contentWidthPx: 820,       
            blockSpacingPx: 24,        
  
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
  
        this.renderHost = document.getElementById("pdfRenderContainer");
        if (!this.renderHost) {
          this.renderHost = document.createElement("div");
          this.renderHost.id = "pdfRenderContainer";
          this.renderHost.style.cssText =
            "position:absolute;left:-9999px;top:0;background:white;";
          document.body.appendChild(this.renderHost);
        }
      }
  
      async generatePDF(items) {
        if (!Array.isArray(items) || items.length === 0) {
          throw new Error("No items to export.");
        }
  
        const { wrapper, cards } = await this._buildContinuousDocument(items);
  
        await this._typeset(wrapper);
        await new Promise((r) => setTimeout(r, 120));
  
        const bigCanvas = await html2canvas(wrapper, {
          backgroundColor: "#ffffff",
          scale: this.options.rasterScale,
          useCORS: true,
          imageTimeout: 0,
          logging: false,
        });
  
        const slices = this._computePageSlices(wrapper, cards, bigCanvas);
  
        this.renderHost.removeChild(wrapper);
  
        await this._buildPdfFromSlices(bigCanvas, slices);
      }
  
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
  
      _computePageSlices(wrapper, cards, bigCanvas) {
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
        const pxToPt = usableWidthPt / bigCanvas.width;
        const pageSliceHeightPx = Math.floor(usableHeightPt / pxToPt);
  
        const wrapperTop = wrapper.getBoundingClientRect().top;
        const cardRectsPx = cards.map((el) => {
          const r = el.getBoundingClientRect();
          const topPx = (r.top - wrapperTop) + wrapper.scrollTop;
          const heightPx = r.height;
          return {
            topPx: Math.round(topPx * this.options.rasterScale),
            heightPx: Math.round(heightPx * this.options.rasterScale),
          };
        });
  
        const slices = [];
        let pageStartPx = 0;
        let usedPx = 0;               
        let currentIndex = 0;
  
        while (currentIndex < cardRectsPx.length) {
          usedPx = 0;
          const pageMaxPx = pageSliceHeightPx;
  
          let lastCardBottomPx = pageStartPx;
          while (currentIndex < cardRectsPx.length) {
            const c = cardRectsPx[currentIndex];
            const cardTopPx = c.topPx;
            const cardBottomPx = c.topPx + c.heightPx;

            if (usedPx === 0) {
              pageStartPx = cardTopPx;
            }
  
            const nextUsedPx = (cardBottomPx - pageStartPx);
  
            if (nextUsedPx <= pageMaxPx) {
              usedPx = nextUsedPx;
              lastCardBottomPx = cardBottomPx;
              currentIndex += 1;
            } else {
              break;
            }
          }
  
          if (usedPx > 0) {
            slices.push({
              yStartPx: pageStartPx,
              yEndPx: lastCardBottomPx,
              usableWidthPt,
              pxToPt,
              margin,
              usableHeightPt,
            });
            pageStartPx = lastCardBottomPx;
          } else {
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
  
    window.LatexPDFGenerator = LatexPDFGenerator;
  })();
  