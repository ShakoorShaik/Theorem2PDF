const uploadBox = document.getElementById('uploadBox');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const processBtn = document.getElementById('processBtn');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const extractedContent = document.getElementById('extractedContent');
const downloadBtn = document.getElementById('downloadBtn');
const errorDiv = document.getElementById('error');

let currentFile = null;
let extractedData = [];

uploadBox.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
});

uploadBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadBox.classList.add('dragover');
});

uploadBox.addEventListener('dragleave', () => {
    uploadBox.classList.remove('dragover');
});

uploadBox.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
    if (!file) return;

    if (file.type !== 'application/pdf') {
        showError('Please upload a PDF file');
        return;
    }

    currentFile = file;
    fileName.textContent = file.name;
    uploadBox.style.display = 'none';
    fileInfo.style.display = 'block';
    hideError();
}

processBtn.addEventListener('click', async () => {
    if (!currentFile) return;

    try {
        showLoading();
        hideError();
        results.style.display = 'none';

        const formData = new FormData();
        formData.append('pdf', currentFile);

        const port = window.location.port || '3000';
        const apiUrl = `http://localhost:${port}/api/extract`;
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Server is not responding correctly. Make sure the server is running on port 3000.');
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to process PDF');
        }

        if (!data.content || data.content.length === 0) {
            throw new Error('No mathematical content was extracted. Make sure your PDF contains definitions, theorems, or lemmas.');
        }

        extractedData = data.content;
        displayResults(extractedData);
        hideLoading();
        results.style.display = 'block';

    } catch (error) {
        hideLoading();
        console.error('Error:', error);
        showError(error.message);
    }
});

function displayResults(content) {
    extractedContent.innerHTML = '';

    if (!content || content.length === 0) {
        extractedContent.innerHTML = '<p style="text-align: center; color: #718096;">No mathematical content found in the PDF. Make sure your PDF contains clearly labeled definitions, theorems, lemmas, or propositions.</p>';
        return;
    }

    const summaryDiv = document.createElement('div');
    summaryDiv.style.cssText = 'background: #f0f4ff; padding: 15px; border-radius: 8px; margin-bottom: 20px;';
    summaryDiv.innerHTML = `<strong>Found ${content.length} mathematical items</strong>`;
    extractedContent.appendChild(summaryDiv);

    content.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = `content-item ${item.type.toLowerCase()}`;
        
        const typeSpan = document.createElement('span');
        typeSpan.className = `content-type ${item.type.toLowerCase()}`;
        typeSpan.textContent = item.type;
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'content-title';
        titleDiv.textContent = item.title || `${item.type} ${index + 1}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content-text';
        contentDiv.textContent = item.content;
        
        itemDiv.appendChild(typeSpan);
        itemDiv.appendChild(titleDiv);
        itemDiv.appendChild(contentDiv);
        
        extractedContent.appendChild(itemDiv);
    });
}

downloadBtn.addEventListener('click', () => {
    generatePDF(extractedData);
});

function generatePDF(content) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - 2 * margin;
    let yPosition = margin;

    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    doc.text('Extracted Mathematical Content', margin, yPosition);
    yPosition += 15;

    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Generated on ${new Date().toLocaleDateString()}`, margin, yPosition);
    yPosition += 15;

    content.forEach((item, index) => {
        if (yPosition > pageHeight - 40) {
            doc.addPage();
            yPosition = margin;
        }

        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(100, 100, 100);
        doc.text(item.type.toUpperCase(), margin, yPosition);
        yPosition += 7;

        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(0, 0, 0);
        const title = item.title || `${item.type} ${index + 1}`;
        const titleLines = doc.splitTextToSize(title, maxWidth);
        doc.text(titleLines, margin, yPosition);
        yPosition += titleLines.length * 7;

        doc.setFontSize(11);
        doc.setFont(undefined, 'normal');
        const contentLines = doc.splitTextToSize(item.content, maxWidth);
        doc.text(contentLines, margin, yPosition);
        yPosition += contentLines.length * 6 + 12;

        if (index < content.length - 1) {
            doc.setDrawColor(200, 200, 200);
            doc.line(margin, yPosition - 7, pageWidth - margin, yPosition - 7);
            yPosition += 5;
        }
    });

    const fileName = `math-notes-extracted-${Date.now()}.pdf`;
    doc.save(fileName);
}

function showLoading() {
    loading.style.display = 'block';
    fileInfo.style.display = 'none';
}

function hideLoading() {
    loading.style.display = 'none';
}

function showError(message) {
    errorDiv.querySelector('p').textContent = message;
    errorDiv.style.display = 'block';
}

function hideError() {
    errorDiv.style.display = 'none';
}