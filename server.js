const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const OpenAI = require('openai');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

app.post('/api/extract', upload.single('pdf'), async (req, res) => {
  try {
    console.log('Received file upload request');
    
    if (!req.file) {
      console.log('No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File received:', req.file.originalname);
    const filePath = req.file.path;
    
    console.log('Parsing PDF...');
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    const pdfText = pdfData.text;
    const pageCount = pdfData.numpages;
    console.log(`PDF parsed - Pages: ${pageCount}, Text length: ${pdfText.length} characters`);
    fs.unlinkSync(filePath);
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      console.error('OpenAI API key not set!');
      return res.status(500).json({ 
        error: 'Server configuration error: OpenAI API key not set. Please check the .env file.' 
      });
    }

    console.log('Calling OpenAI API for extraction...');
    const extracted = await extractMathContent(pdfText);
    console.log('Extraction complete, found', extracted.length, 'items');

    res.json({ 
      success: true, 
      content: extracted,
      stats: {
        totalPages: pageCount,
        totalItems: extracted.length
      }
    });

  } catch (error) {
    console.error('Error processing PDF:', error);
    res.status(500).json({ 
      error: 'Failed to process PDF', 
      details: error.message 
    });
  }
});

function chunkText(text, chunkSize = 15000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.substring(i, i + chunkSize));
  }
  return chunks;
}

async function extractMathContent(text) {
  try {
    const chunks = chunkText(text, 15000);
    console.log(`Processing ${chunks.length} chunks...`);
    
    let allExtractions = [];
    
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
      
      const prompt = `You are an expert at extracting mathematical content from academic notes. 

Analyze the following text and extract ALL definitions, theorems, lemmas, propositions, corollaries, and axioms.

For each item you find:
1. Identify its type (Definition, Theorem, Lemma, Proposition, Corollary, or Axiom)
2. Extract the complete statement
3. Include any numbering or labeling if present
4. Preserve mathematical notation as closely as possible

Format your response as a JSON object with an "items" array:
{
  "items": [
    {
      "type": "Definition",
      "title": "Definition 1.2 (Optional Name)",
      "content": "The complete definition text..."
    },
    {
      "type": "Theorem",
      "title": "Theorem 3.1 (Pythagorean Theorem)",
      "content": "The complete theorem statement..."
    }
  ]
}

Only include actual mathematical statements, not examples or explanations.

Text to analyze:
${chunks[i]}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: 'You are a mathematical content extraction assistant. Always respond with valid JSON.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(response.choices[0].message.content);
      
      let chunkItems = [];
      if (result.items && Array.isArray(result.items)) {
        chunkItems = result.items;
      } else if (Array.isArray(result)) {
        chunkItems = result;
      } else if (result.extractions) {
        chunkItems = result.extractions;
      } else {
        const firstKey = Object.keys(result)[0];
        if (Array.isArray(result[firstKey])) {
          chunkItems = result[firstKey];
        }
      }
      
      console.log(`Found ${chunkItems.length} items in chunk ${i + 1}`);
      allExtractions = allExtractions.concat(chunkItems);
      
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`Total items extracted: ${allExtractions.length}`);
    
    const uniqueExtractions = removeDuplicates(allExtractions);
    console.log(`After removing duplicates: ${uniqueExtractions.length}`);
    
    return uniqueExtractions;

  } catch (error) {
    console.error('Error extracting math content:', error);
    throw new Error('Failed to extract mathematical content: ' + error.message);
  }
}

function removeDuplicates(items) {
  const seen = new Set();
  const unique = [];
  
  for (const item of items) {
    const key = item.content.substring(0, 100).toLowerCase().trim();
    
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  
  return unique;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Make sure your OpenAI API key is set in the .env file`);
});