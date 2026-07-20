import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import pg from "pg";
import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
import mammoth from "mammoth";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// 1. Initialize API Clients and Database Pool
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Initialize Gemini SDK with User-Agent header for telemetry
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
  })
  : null;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateContentWithFallback({
  contents,
  config
}: {
  contents: any;
  config: any;
}) {
  if (!ai) {
    throw new Error("Gemini AI API Key is not configured.");
  }

  const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Gemini API] Attempting content generation with ${modelName} (attempt ${attempt}/2)...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents,
          config,
        });
        console.log(`[Gemini API] Success using ${modelName}`);
        return response;
      } catch (err: any) {
        const errMsg = err?.message || JSON.stringify(err);
        console.log(`[Gemini API] Attempt ${attempt} with ${modelName} failed. Error: ${errMsg}`);
        lastError = err;
        if (attempt < 2) {
          const sleepTime = attempt * 1500;
          await delay(sleepTime);
        }
      }
    }
  }

  throw lastError || new Error("Failed to generate content with any model.");
}

// Initialize Cloudinary
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log("Cloudinary client initialized successfully.");
} else {
  console.warn("Cloudinary environment variables are missing. File uploads to Cloudinary will fail.");
}

// --- Begin Robust Local JSON Database Fallback Implementation ---
const DB_FILE = process.env.VERCEL
  ? path.join("/tmp", "minesec_db.json")
  : path.join(process.cwd(), "minesec_db.json");

interface DBData {
  syllabi: any[];
  lessons: any[];
  lesson_history: any[];
  lectures?: any[];
  quizzes?: any[];
  quiz_results?: any[];
}

class JsonDb {
  private data: DBData = {
    syllabi: [],
    lessons: [],
    lesson_history: [],
    lectures: [],
    quizzes: [],
    quiz_results: [],
  };

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, "utf-8");
        this.data = JSON.parse(raw);
        this.data.syllabi = this.data.syllabi || [];
        this.data.lessons = this.data.lessons || [];
        this.data.lesson_history = this.data.lesson_history || [];
        this.data.lectures = this.data.lectures || [];
        this.data.quizzes = this.data.quizzes || [];
        this.data.quiz_results = this.data.quiz_results || [];
        console.log(`[JSON DB] Loaded successfully with ${this.data.syllabi.length} syllabi, ${this.data.lessons.length} lessons, ${this.data.lectures.length} lectures, ${this.data.quizzes.length} quizzes, ${this.data.quiz_results.length} quiz results, and ${this.data.lesson_history.length} history records.`);
      } else {
        this.save();
      }
    } catch (err) {
      console.error("[JSON DB] Failed to load database file:", err);
    }
  }

  private save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error("[JSON DB] Failed to write database file:", err);
    }
  }

  async query(text: string, params?: any[]): Promise<{ rows: any[] }> {
    const t = text.trim();
    try {
      if (t.includes("SELECT") && t.includes("FROM syllabi") && !t.includes("WHERE")) {
        const rows = [...this.data.syllabi].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return { rows };
      }
      if (t.includes("SELECT * FROM syllabi WHERE id = $1") || (t.includes("SELECT * FROM syllabi") && t.includes("id = $1"))) {
        const id = Number(params?.[0]);
        const row = this.data.syllabi.find(s => s.id === id);
        return { rows: row ? [row] : [] };
      }
      if (t.includes("INSERT INTO syllabi")) {
        const [title, subject, class_level, academic_year, file_url, file_name, file_type, file_size, status, extracted_metadata_str] = params || [];
        const id = this.data.syllabi.length > 0 ? Math.max(...this.data.syllabi.map(s => s.id)) + 1 : 1;
        const newRow = {
          id,
          title,
          subject,
          class_level,
          academic_year,
          file_url,
          file_name,
          file_type,
          file_size: Number(file_size || 0),
          status: status || "published",
          extracted_metadata: typeof extracted_metadata_str === "string" ? JSON.parse(extracted_metadata_str) : extracted_metadata_str,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.data.syllabi.push(newRow);
        this.save();
        return { rows: [newRow] };
      }
      if (t.includes("UPDATE syllabi")) {
        const [title, subject, class_level, academic_year, status, extracted_metadata_str, idVal] = params || [];
        const id = Number(idVal);
        const idx = this.data.syllabi.findIndex(s => s.id === id);
        if (idx === -1) {
          return { rows: [] };
        }
        const updatedRow = {
          ...this.data.syllabi[idx],
          title: title !== undefined ? title : this.data.syllabi[idx].title,
          subject: subject !== undefined ? subject : this.data.syllabi[idx].subject,
          class_level: class_level !== undefined ? class_level : this.data.syllabi[idx].class_level,
          academic_year: academic_year !== undefined ? academic_year : this.data.syllabi[idx].academic_year,
          status: status !== undefined ? status : this.data.syllabi[idx].status,
          extracted_metadata: typeof extracted_metadata_str === "string" ? JSON.parse(extracted_metadata_str) : (extracted_metadata_str !== undefined ? extracted_metadata_str : this.data.syllabi[idx].extracted_metadata),
          updated_at: new Date().toISOString(),
        };
        this.data.syllabi[idx] = updatedRow;
        this.save();
        return { rows: [updatedRow] };
      }
      if (t.includes("DELETE FROM syllabi WHERE id = $1")) {
        const id = Number(params?.[0]);
        const idx = this.data.syllabi.findIndex(s => s.id === id);
        if (idx === -1) {
          return { rows: [] };
        }
        const deleted = this.data.syllabi.splice(idx, 1)[0];
        this.save();
        return { rows: [deleted] };
      }
      if (t.includes("SELECT l.*, s.title as syllabus_title FROM lessons l LEFT JOIN syllabi s")) {
        if (t.includes("l.id = $1")) {
          const id = Number(params?.[0]);
          const lesson = this.data.lessons.find(l => l.id === id);
          if (!lesson) {
            return { rows: [] };
          }
          const s = this.data.syllabi.find(sy => sy.id === lesson.syllabus_id);
          return {
            rows: [{
              ...lesson,
              syllabus_title: s ? s.title : null,
            }]
          };
        }
        let filtered = [...this.data.lessons];
        for (let i = 0; params && i < params.length; i++) {
          const pVal = params[i];
          const statusMatch = new RegExp(`l\\.status\\s*=\\s*\\$${i+1}`).test(t);
          const subjectMatch = new RegExp(`l\\.subject\\s+ILIKE\\s+\\$${i+1}`).test(t);
          const searchMatch = new RegExp(`l\\.title\\s+ILIKE\\s+\\$${i+1}`).test(t) || new RegExp(`l\\.lesson_content\\s+ILIKE\\s+\\$${i+1}`).test(t) || new RegExp(`l\\.teacher_name\\s+ILIKE\\s+\\$${i+1}`).test(t);
          const idMatch = new RegExp(`l\\.id\\s*=\\s*\\$${i+1}`).test(t);

          if (idMatch) {
            filtered = filtered.filter(l => l.id === Number(pVal));
          } else if (statusMatch) {
            filtered = filtered.filter(l => l.status === pVal);
          } else if (subjectMatch) {
            const cleanSub = String(pVal).replace(/%/g, "").toLowerCase();
            filtered = filtered.filter(l => (l.subject || "").toLowerCase().includes(cleanSub));
          } else if (searchMatch) {
            const cleanSearch = String(pVal).replace(/%/g, "").toLowerCase();
            filtered = filtered.filter(l => 
              (l.title || "").toLowerCase().includes(cleanSearch) || 
              (l.lesson_content || "").toLowerCase().includes(cleanSearch) || 
              (l.teacher_name || "").toLowerCase().includes(cleanSearch)
            );
          }
        }
        const rows = filtered.map(l => {
          const s = this.data.syllabi.find(sy => sy.id === l.syllabus_id);
          return {
            ...l,
            syllabus_title: s ? s.title : null,
          };
        });
        rows.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        return { rows };
      }
      if (t.includes("SELECT * FROM lessons WHERE id = $1")) {
        const id = Number(params?.[0]);
        const lesson = this.data.lessons.find(l => l.id === id);
        return { rows: lesson ? [lesson] : [] };
      }
      if (t.includes("SELECT version FROM lessons WHERE id = $1")) {
        const id = Number(params?.[0]);
        const lesson = this.data.lessons.find(l => l.id === id);
        return { rows: lesson ? [{ version: lesson.version }] : [] };
      }
      if (t.includes("SELECT id, version, title, created_at FROM lesson_history WHERE lesson_id = $1")) {
        const lesson_id = Number(params?.[0]);
        const rows = this.data.lesson_history
          .filter(h => h.lesson_id === lesson_id)
          .map(h => ({ id: h.id, version: h.version, title: h.title, created_at: h.created_at }))
          .sort((a, b) => b.version - a.version);
        return { rows };
      }
      if (t.includes("SELECT * FROM lesson_history WHERE lesson_id = $1 AND id = $2")) {
        const lesson_id = Number(params?.[0]);
        const id = Number(params?.[1]);
        const rows = this.data.lesson_history.filter(h => h.lesson_id === lesson_id && h.id === id);
        return { rows };
      }
      if (t.includes("INSERT INTO lessons")) {
        const [title, subject, class_level, duration, syllabus_id, status, teacher_name, competency_mapping_str, learning_objectives_str, lesson_content, assessment_data_str, metadata_str] = params || [];
        const id = this.data.lessons.length > 0 ? Math.max(...this.data.lessons.map(l => l.id)) + 1 : 1;
        const newRow = {
          id,
          title: title || "Untitled Lesson Plan",
          subject: subject || "",
          class_level: class_level || "",
          duration: duration || "2 Hours",
          syllabus_id: syllabus_id ? Number(syllabus_id) : null,
          status: status || "draft",
          teacher_name: teacher_name || "Minesec Teacher",
          competency_mapping: typeof competency_mapping_str === "string" ? JSON.parse(competency_mapping_str) : competency_mapping_str,
          learning_objectives: typeof learning_objectives_str === "string" ? JSON.parse(learning_objectives_str) : learning_objectives_str,
          lesson_content: lesson_content || "",
          assessment_data: typeof assessment_data_str === "string" ? JSON.parse(assessment_data_str) : assessment_data_str,
          metadata: typeof metadata_str === "string" ? JSON.parse(metadata_str) : metadata_str,
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.data.lessons.push(newRow);
        this.save();
        return { rows: [newRow] };
      }
      if (t.includes("INSERT INTO lesson_history")) {
        const [lesson_id, version, title, lesson_content, competency_mapping_str, learning_objectives_str] = params || [];
        const id = this.data.lesson_history.length > 0 ? Math.max(...this.data.lesson_history.map(h => h.id)) + 1 : 1;
        const newRow = {
          id,
          lesson_id: Number(lesson_id),
          version: Number(version),
          title,
          lesson_content,
          competency_mapping: typeof competency_mapping_str === "string" ? JSON.parse(competency_mapping_str) : competency_mapping_str,
          learning_objectives: typeof learning_objectives_str === "string" ? JSON.parse(learning_objectives_str) : learning_objectives_str,
          created_at: new Date().toISOString(),
        };
        this.data.lesson_history.push(newRow);
        this.save();
        return { rows: [newRow] };
      }
      if (t.includes("UPDATE lessons")) {
        let id = 0;
        let updatedRow: any = null;
        if (params && params.length === 6) {
          const [title, lesson_content, competency_mapping_str, learning_objectives_str, version, idVal] = params;
          id = Number(idVal);
          const idx = this.data.lessons.findIndex(l => l.id === id);
          if (idx !== -1) {
            updatedRow = {
              ...this.data.lessons[idx],
              title,
              lesson_content,
              competency_mapping: typeof competency_mapping_str === "string" ? JSON.parse(competency_mapping_str) : competency_mapping_str,
              learning_objectives: typeof learning_objectives_str === "string" ? JSON.parse(learning_objectives_str) : learning_objectives_str,
              version: Number(version),
              updated_at: new Date().toISOString(),
            };
            this.data.lessons[idx] = updatedRow;
          }
        } else {
          const [
            title, subject, class_level, duration, syllabus_id, status, teacher_name,
            competency_mapping_str, learning_objectives_str, lesson_content, assessment_data_str, metadata_str,
            version, idVal
          ] = params || [];
          id = Number(idVal);
          const idx = this.data.lessons.findIndex(l => l.id === id);
          if (idx !== -1) {
            updatedRow = {
              ...this.data.lessons[idx],
              title: title || this.data.lessons[idx].title,
              subject: subject !== undefined ? subject : this.data.lessons[idx].subject,
              class_level: class_level !== undefined ? class_level : this.data.lessons[idx].class_level,
              duration: duration !== undefined ? duration : this.data.lessons[idx].duration,
              syllabus_id: syllabus_id !== undefined ? (syllabus_id ? Number(syllabus_id) : null) : this.data.lessons[idx].syllabus_id,
              status: status !== undefined ? status : this.data.lessons[idx].status,
              teacher_name: teacher_name !== undefined ? teacher_name : this.data.lessons[idx].teacher_name,
              competency_mapping: typeof competency_mapping_str === "string" ? JSON.parse(competency_mapping_str) : (competency_mapping_str !== undefined ? competency_mapping_str : this.data.lessons[idx].competency_mapping),
              learning_objectives: typeof learning_objectives_str === "string" ? JSON.parse(learning_objectives_str) : (learning_objectives_str !== undefined ? learning_objectives_str : this.data.lessons[idx].learning_objectives),
              lesson_content: lesson_content !== undefined ? lesson_content : this.data.lessons[idx].lesson_content,
              assessment_data: typeof assessment_data_str === "string" ? JSON.parse(assessment_data_str) : (assessment_data_str !== undefined ? assessment_data_str : this.data.lessons[idx].assessment_data),
              metadata: typeof metadata_str === "string" ? JSON.parse(metadata_str) : (metadata_str !== undefined ? metadata_str : this.data.lessons[idx].metadata),
              version: Number(version),
              updated_at: new Date().toISOString(),
            };
            this.data.lessons[idx] = updatedRow;
          }
        }
        if (updatedRow) {
          this.save();
          return { rows: [updatedRow] };
        }
        return { rows: [] };
      }
      if (t.includes("DELETE FROM lessons WHERE id = $1")) {
        const id = Number(params?.[0]);
        const idx = this.data.lessons.findIndex(l => l.id === id);
        if (idx === -1) {
          return { rows: [] };
        }
        const deleted = this.data.lessons.splice(idx, 1)[0];
        this.data.lesson_history = this.data.lesson_history.filter(h => h.lesson_id !== id);
        this.save();
        return { rows: [deleted] };
      }
      if (t.includes("SELECT * FROM lectures") || t.includes("SELECT l.* FROM lectures")) {
        if (t.includes("WHERE id = $1") || t.includes("l.id = $1")) {
          const id = Number(params?.[0]);
          const row = (this.data.lectures || []).find(l => l.id === id);
          return { rows: row ? [row] : [] };
        }
        return { rows: this.data.lectures || [] };
      }
      if (t.includes("INSERT INTO lectures")) {
        const [title, topic, subject, class_level, syllabus_id, content, metadata_str] = params || [];
        const id = (this.data.lectures || []).length > 0 ? Math.max(...(this.data.lectures || []).map(l => l.id)) + 1 : 1;
        const newRow = {
          id,
          title,
          topic,
          subject,
          class_level,
          syllabus_id: syllabus_id ? Number(syllabus_id) : null,
          content,
          metadata: typeof metadata_str === "string" ? JSON.parse(metadata_str) : metadata_str,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.data.lectures = this.data.lectures || [];
        this.data.lectures.push(newRow);
        this.save();
        return { rows: [newRow] };
      }
      if (t.includes("DELETE FROM lectures WHERE id = $1")) {
        const id = Number(params?.[0]);
        this.data.lectures = this.data.lectures || [];
        const idx = this.data.lectures.findIndex(l => l.id === id);
        if (idx === -1) return { rows: [] };
        const deleted = this.data.lectures.splice(idx, 1)[0];
        this.save();
        return { rows: [deleted] };
      }
      if (t.includes("UPDATE lectures")) {
        const [title, topic, subject, class_level, content, metadata_str, idVal] = params || [];
        const id = Number(idVal);
        this.data.lectures = this.data.lectures || [];
        const idx = this.data.lectures.findIndex(l => l.id === id);
        if (idx === -1) return { rows: [] };
        const updatedRow = {
          ...this.data.lectures[idx],
          title: title !== undefined ? title : this.data.lectures[idx].title,
          topic: topic !== undefined ? topic : this.data.lectures[idx].topic,
          subject: subject !== undefined ? subject : this.data.lectures[idx].subject,
          class_level: class_level !== undefined ? class_level : this.data.lectures[idx].class_level,
          content: content !== undefined ? content : this.data.lectures[idx].content,
          metadata: typeof metadata_str === "string" ? JSON.parse(metadata_str) : (metadata_str !== undefined ? metadata_str : this.data.lectures[idx].metadata),
          updated_at: new Date().toISOString(),
        };
        this.data.lectures[idx] = updatedRow;
        this.save();
        return { rows: [updatedRow] };
      }
      if (t.includes("SELECT * FROM quizzes") || t.includes("SELECT q.* FROM quizzes")) {
        if (t.includes("WHERE id = $1") || t.includes("q.id = $1")) {
          const id = Number(params?.[0]);
          const row = (this.data.quizzes || []).find(q => q.id === id);
          return { rows: row ? [row] : [] };
        }
        return { rows: this.data.quizzes || [] };
      }
      if (t.includes("INSERT INTO quizzes")) {
        const [title, topic, syllabus_id, lesson_id, questions_str, difficulty, class_level, subject] = params || [];
        const id = (this.data.quizzes || []).length > 0 ? Math.max(...(this.data.quizzes || []).map(q => q.id)) + 1 : 1;
        const newRow = {
          id,
          title,
          topic,
          syllabus_id: syllabus_id ? Number(syllabus_id) : null,
          lesson_id: lesson_id ? Number(lesson_id) : null,
          questions: typeof questions_str === "string" ? JSON.parse(questions_str) : questions_str,
          difficulty,
          class_level,
          subject,
          created_at: new Date().toISOString(),
        };
        this.data.quizzes = this.data.quizzes || [];
        this.data.quizzes.push(newRow);
        this.save();
        return { rows: [newRow] };
      }
      if (t.includes("DELETE FROM quizzes WHERE id = $1")) {
        const id = Number(params?.[0]);
        this.data.quizzes = this.data.quizzes || [];
        const idx = this.data.quizzes.findIndex(q => q.id === id);
        if (idx === -1) return { rows: [] };
        const deleted = this.data.quizzes.splice(idx, 1)[0];
        this.save();
        return { rows: [deleted] };
      }
      if (t.includes("INSERT INTO quiz_results")) {
        const [quiz_id, student_name, score, total, percentage, answers_str] = params || [];
        const id = (this.data.quiz_results || []).length > 0 ? Math.max(...(this.data.quiz_results || []).map(r => r.id)) + 1 : 1;
        const newRow = {
          id,
          quiz_id: Number(quiz_id),
          student_name: student_name || "Minesec Student",
          score: Number(score || 0),
          total: Number(total || 0),
          percentage: Number(percentage || 0),
          answers: typeof answers_str === "string" ? JSON.parse(answers_str) : answers_str,
          created_at: new Date().toISOString()
        };
        this.data.quiz_results = this.data.quiz_results || [];
        this.data.quiz_results.push(newRow);
        this.save();
        return { rows: [newRow] };
      }
      if (t.includes("SELECT") && t.includes("FROM quiz_results")) {
        this.data.quiz_results = this.data.quiz_results || [];
        if (t.includes("WHERE quiz_id = $1")) {
          const qid = Number(params?.[0]);
          const rows = this.data.quiz_results.filter(r => r.quiz_id === qid);
          return { rows };
        }
        return { rows: this.data.quiz_results };
      }
      console.warn("[JSON DB] Unmatched query intercepted:", text, params);
      return { rows: [] };
    } catch (e) {
      console.error("[JSON DB] Query processing error:", e);
      return { rows: [] };
    }
  }
}

// Initialize PostgreSQL Pool (Neon / Cloud SQL)
function getCleanedDatabaseUrl() {
  let url = process.env.DATABASE_URL;
  if (url && url.startsWith("DATABASE_URL=")) {
    url = url.substring("DATABASE_URL=".length);
  }
  return url;
}

const cleanedDbUrl = getCleanedDatabaseUrl();

let pool: any = cleanedDbUrl
  ? new Pool({
      connectionString: cleanedDbUrl,
      connectionTimeoutMillis: 5000,
      ssl: cleanedDbUrl.includes("sslmode=require") || cleanedDbUrl.includes("neon")
        ? { rejectUnauthorized: false }
        : undefined,
    })
  : null;

// Initialize as JsonDb immediately if no DB URL is set
if (!pool) {
  pool = new JsonDb();
}

// Database Auto-Initialization
async function initDatabase() {
  const cleanedUrl = getCleanedDatabaseUrl();
  if (!cleanedUrl) {
    throw new Error("DATABASE_URL is not set. A live Neon PostgreSQL database is required for this application.");
  }
  try {
    const client = await pool.connect();
    console.log("Connected to Neon PostgreSQL database successfully.");

    // Create syllabi table
    await client.query(`
      CREATE TABLE IF NOT EXISTS syllabi (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        subject VARCHAR(100),
        class_level VARCHAR(100),
        academic_year VARCHAR(50),
        file_url TEXT,
        file_name VARCHAR(255),
        file_type VARCHAR(50),
        file_size INTEGER,
        status VARCHAR(50) DEFAULT 'published',
        extracted_metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create lessons table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        subject VARCHAR(100),
        class_level VARCHAR(100),
        duration VARCHAR(100),
        syllabus_id INTEGER REFERENCES syllabi(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'draft',
        teacher_name VARCHAR(100),
        competency_mapping JSONB,
        learning_objectives JSONB,
        lesson_content TEXT,
        assessment_data JSONB,
        metadata JSONB,
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create lesson_history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lesson_history (
        id SERIAL PRIMARY KEY,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        lesson_content TEXT,
        competency_mapping JSONB,
        learning_objectives JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create lectures table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lectures (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        topic VARCHAR(255),
        subject VARCHAR(100),
        class_level VARCHAR(100),
        syllabus_id INTEGER REFERENCES syllabi(id) ON DELETE SET NULL,
        content TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create quizzes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        topic VARCHAR(255),
        syllabus_id INTEGER REFERENCES syllabi(id) ON DELETE SET NULL,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
        questions JSONB,
        difficulty VARCHAR(50),
        class_level VARCHAR(100),
        subject VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create quiz_results table for student score reporting
    await client.query(`
      CREATE TABLE IF NOT EXISTS quiz_results (
        id SERIAL PRIMARY KEY,
        quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
        student_name VARCHAR(255) NOT NULL,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        percentage INTEGER NOT NULL,
        answers JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    client.release();
    console.log("Database tables initialized successfully.");
  } catch (err: any) {
    console.error("Database initialization failed:", err);
    throw err;
  }
}

// 2. Multer Setup for Stream-To-Disk (Avoids Not Enough Memory issues)
const uploadDir = process.env.VERCEL
  ? "/tmp"
  : path.join(process.cwd(), "tmp-uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB file size limit
});

// Helper: Download file from external URL to local temp directory
async function downloadFileFromUrl(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file from Cloudinary: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(destPath, buffer);
}

// Helper: Parse Document Text from File Path
async function extractTextFromFile(filePath: string, fileType: string): Promise<string> {
  if (fileType.includes("pdf")) {
    const dataBuffer = fs.readFileSync(filePath);
    const result = await pdfParse(dataBuffer);
    return result.text;
  } else if (fileType.includes("wordprocessingml") || fileType.includes("docx")) {
    const parsed = await mammoth.extractRawText({ path: filePath });
    return parsed.value;
  } else {
    // Treat as simple text
    return fs.readFileSync(filePath, "utf-8");
  }
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    database: getCleanedDatabaseUrl() ? "configured" : "missing",
    cloudinary: process.env.CLOUDINARY_CLOUD_NAME ? "configured" : "missing",
    gemini: process.env.GEMINI_API_KEY ? "configured" : "missing",
  });
});

// Generate Cloudinary Signature for Direct Client-Side Uploads (bypasses serverless file size limits)
app.post("/api/cloudinary-signature", (req, res) => {
  const { folder } = req.body;
  if (!process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_CLOUD_NAME) {
    return res.status(500).json({ error: "Cloudinary credentials are not configured on the server." });
  }

  const timestamp = Math.round(new Date().getTime() / 1000);
  const targetFolder = folder || "minesec_general";

  const paramsToSign = {
    timestamp: timestamp,
    folder: targetFolder,
  };

  const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);

  res.json({
    signature,
    timestamp,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    folder: targetFolder,
  });
});

// ==========================================
// SYLLABUS MANAGER APIs
// ==========================================

// List all syllabi
app.get("/api/syllabi", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, title, subject, class_level, academic_year, file_url, file_name, file_type, file_size, status, created_at, updated_at FROM syllabi ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error: any) {
    console.error("Failed to fetch syllabi:", error);
    res.status(500).json({ error: "Failed to fetch syllabi: " + error.message });
  }
});

// Get syllabus details with its extracted metadata
app.get("/api/syllabi/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM syllabi WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Syllabus not found" });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    console.error("Failed to fetch syllabus details:", error);
    res.status(500).json({ error: "Failed to fetch syllabus details" });
  }
});

// Create and Index Syllabus (Secure upload & parse)
app.post("/api/syllabi/upload", upload.single("file"), async (req, res) => {
  let filePath = "";
  let fileName = "";
  let fileType = "";
  let fileSize = 0;
  let fileUrl = "";
  let isDownloaded = false;

  try {
    if (req.file) {
      filePath = req.file.path;
      fileName = req.file.originalname;
      fileType = req.file.mimetype;
      fileSize = req.file.size;
    } else if (req.body && req.body.fileUrl) {
      fileUrl = req.body.fileUrl;
      fileName = req.body.fileName || "syllabus.pdf";
      fileType = req.body.fileType || "application/pdf";
      fileSize = req.body.fileSize || 0;

      // Download file to temp path for text extraction
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      filePath = path.join(uploadDir, "download-" + uniqueSuffix + path.extname(fileName));
      
      console.log(`[Syllabus Upload] Downloading file from direct Cloudinary URL: ${fileUrl} to ${filePath}`);
      await downloadFileFromUrl(fileUrl, filePath);
      isDownloaded = true;
    } else {
      return res.status(400).json({ error: "No file was uploaded or fileUrl provided." });
    }

    let cloudinaryResult: any = null;
    let rawText = "";

    // 1. Upload to Cloudinary securely if uploaded locally
    if (req.file && process.env.CLOUDINARY_CLOUD_NAME) {
      cloudinaryResult = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload(
          filePath,
          { resource_type: "raw", folder: "minesec_syllabi" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
      });
      fileUrl = cloudinaryResult?.secure_url || "";
    }

    // 2. Parse text from document safely
    rawText = await extractTextFromFile(filePath, fileType);
    if (!rawText || rawText.trim().length === 0) {
      throw new Error("Could not extract any readable text from the file.");
    }

    // 3. Send text to Gemini to extract structured index metadata (CBA Alignment)
    if (!ai) {
      throw new Error("Gemini API is not configured. Cannot generate syllabus index.");
    }

    const indexingPrompt = `
      You are an expert AI syllabus indexer specializing in the MINESEC (Cameroon Ministry of Secondary Education) Competency Based Approach (CBA).
      Analyze the syllabus document text below and index it into a structured schema.
      
      Extract:
      1. Subject name
      2. Targeted Class Level (e.g., Sixieme, Premiere, Terminale, Form 1, Form 5, Lower Sixth, Upper Sixth)
      3. Academic Year (if mentioned, otherwise default to "2025/2026")
      4. A comprehensive list of Competencies (the core skills or know-how students acquire)
      5. A list of Learning Outcomes
      6. A detailed list of Modules, Chapters, or Units (each with a Title, Description, and specific Learning Objectives)
      7. Assessment/Grading Standards or criteria (how student competency is evaluated)
      8. Suggested practical exercises, practical sessions, or real-world application projects.
      
      Text of the Syllabus:
      ---START TEXT---
      ${rawText.substring(0, 100000)}
      ---END TEXT---

      Format your response strictly as a JSON object with the following schema:
      {
        "subject": "e.g., Computer Science / Informatique",
        "classLevel": "e.g., Premiere",
        "academicYear": "e.g., 2025/2026",
        "competencies": ["competency 1", "competency 2"],
        "learningOutcomes": ["outcome 1", "outcome 2"],
        "modules": [
          {
            "title": "Module Title",
            "description": "Short module description",
            "objectives": ["objective 1", "objective 2"]
          }
        ],
        "gradingStandards": ["standard 1", "standard 2"],
        "assessmentCriteria": ["criteria 1", "criteria 2"],
        "curriculumStructure": "Brief summary of curriculum organization"
      }
    `;

    const response = await generateContentWithFallback({
      contents: indexingPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            classLevel: { type: Type.STRING },
            academicYear: { type: Type.STRING },
            competencies: { type: Type.ARRAY, items: { type: Type.STRING } },
            learningOutcomes: { type: Type.ARRAY, items: { type: Type.STRING } },
            modules: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["title", "description", "objectives"],
              },
            },
            gradingStandards: { type: Type.ARRAY, items: { type: Type.STRING } },
            assessmentCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
            curriculumStructure: { type: Type.STRING },
          },
          required: ["subject", "classLevel", "competencies", "modules"],
        },
      },
    });

    const parsedMetadata = JSON.parse(response.text?.trim() || "{}");

    // 4. Save Syllabus and Metadata to Neon Database
    const finalFileUrl = fileUrl || (cloudinaryResult?.secure_url || "");
    const insertQuery = `
      INSERT INTO syllabi (title, subject, class_level, academic_year, file_url, file_name, file_type, file_size, status, extracted_metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      parsedMetadata.subject + " Syllabus - " + parsedMetadata.classLevel,
      parsedMetadata.subject,
      parsedMetadata.classLevel,
      parsedMetadata.academicYear || "2025/2026",
      finalFileUrl,
      fileName,
      fileType,
      fileSize,
      "published",
      JSON.stringify(parsedMetadata),
    ];

    const dbResult = await pool.query(insertQuery, values);

    res.status(201).json(dbResult.rows[0]);
  } catch (error: any) {
    console.error("Failed to process syllabus upload:", error);
    res.status(500).json({ error: error.message || "Failed to process and index the syllabus." });
  } finally {
    // Always clean up temp file to prevent memory and disk leaks
    if (filePath && (req.file || isDownloaded) && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error("Failed to delete temp file:", e);
      }
    }
  }
});

// Update Syllabus Metadata
app.put("/api/syllabi/:id", async (req, res) => {
  const { id } = req.params;
  const { title, subject, class_level, academic_year, status, extracted_metadata } = req.body;
  try {
    const query = `
      UPDATE syllabi 
      SET title = $1, subject = $2, class_level = $3, academic_year = $4, status = $5, extracted_metadata = $6, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING *
    `;
    const result = await pool.query(query, [
      title,
      subject,
      class_level,
      academic_year,
      status,
      JSON.stringify(extracted_metadata),
      id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Syllabus not found" });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    console.error("Failed to update syllabus:", error);
    res.status(500).json({ error: "Failed to update syllabus" });
  }
});

// Delete Syllabus
app.delete("/api/syllabi/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("DELETE FROM syllabi WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Syllabus not found" });
    }
    res.json({ message: "Syllabus deleted successfully", deleted: result.rows[0] });
  } catch (error: any) {
    console.error("Failed to delete syllabus:", error);
    res.status(500).json({ error: "Failed to delete syllabus" });
  }
});

// ==========================================
// MINESEC LESSON PREP APIs
// ==========================================

// Get all lessons (Draft and Published) with filters
app.get("/api/lessons", async (req, res) => {
  const { status, search, subject } = req.query;
  try {
    let query = "SELECT l.*, s.title as syllabus_title FROM lessons l LEFT JOIN syllabi s ON l.syllabus_id = s.id WHERE 1=1";
    const params: any[] = [];
    let paramCounter = 1;

    if (status) {
      query += ` AND l.status = $${paramCounter++}`;
      params.push(status);
    }

    if (subject) {
      query += ` AND l.subject ILIKE $${paramCounter++}`;
      params.push(`%${subject}%`);
    }

    if (search) {
      query += ` AND (l.title ILIKE $${paramCounter} OR l.lesson_content ILIKE $${paramCounter} OR l.teacher_name ILIKE $${paramCounter++})`;
      params.push(`%${search}%`);
    }

    query += " ORDER BY l.updated_at DESC";
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error: any) {
    console.error("Failed to fetch lessons:", error);
    res.status(500).json({ error: "Failed to fetch lessons" });
  }
});

// Get a specific lesson detail along with its version history
app.get("/api/lessons/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const lessonRes = await pool.query("SELECT l.*, s.title as syllabus_title FROM lessons l LEFT JOIN syllabi s ON l.syllabus_id = s.id WHERE l.id = $1", [id]);
    if (lessonRes.rows.length === 0) {
      return res.status(404).json({ error: "Lesson not found" });
    }
    const historyRes = await pool.query("SELECT id, version, title, created_at FROM lesson_history WHERE lesson_id = $1 ORDER BY version DESC", [id]);
    res.json({
      ...lessonRes.rows[0],
      history: historyRes.rows,
    });
  } catch (error: any) {
    console.error("Failed to fetch lesson details:", error);
    res.status(500).json({ error: "Failed to fetch lesson details" });
  }
});

// Retrieve a specific historic version of a lesson
app.get("/api/lessons/:id/history/:versionId", async (req, res) => {
  const { id, versionId } = req.params;
  try {
    const historyRes = await pool.query("SELECT * FROM lesson_history WHERE lesson_id = $1 AND id = $2", [id, versionId]);
    if (historyRes.rows.length === 0) {
      return res.status(404).json({ error: "Lesson version history not found" });
    }
    res.json(historyRes.rows[0]);
  } catch (error: any) {
    console.error("Failed to retrieve historic version:", error);
    res.status(500).json({ error: "Failed to retrieve historic version" });
  }
});

// Create a new Lesson Plan (Draft / Empty)
app.post("/api/lessons", async (req, res) => {
  const { title, subject, class_level, duration, syllabus_id, teacher_name, competency_mapping, learning_objectives, lesson_content, assessment_data, status, metadata } = req.body;
  try {
    const query = `
      INSERT INTO lessons (title, subject, class_level, duration, syllabus_id, status, teacher_name, competency_mapping, learning_objectives, lesson_content, assessment_data, metadata, version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1)
      RETURNING *
    `;
    const result = await pool.query(query, [
      title || "Untitled Lesson Plan",
      subject || "",
      class_level || "",
      duration || "2 Hours",
      syllabus_id || null,
      status || "draft",
      teacher_name || "Minesec Teacher",
      JSON.stringify(competency_mapping || {}),
      JSON.stringify(learning_objectives || []),
      lesson_content || "",
      JSON.stringify(assessment_data || {}),
      JSON.stringify(metadata || {}),
    ]);

    const newLesson = result.rows[0];

    // Create the initial history version
    await pool.query(
      `INSERT INTO lesson_history (lesson_id, version, title, lesson_content, competency_mapping, learning_objectives) VALUES ($1, 1, $2, $3, $4, $5)`,
      [newLesson.id, newLesson.title, newLesson.lesson_content, JSON.stringify(newLesson.competency_mapping), JSON.stringify(newLesson.learning_objectives)]
    );

    res.status(201).json(newLesson);
  } catch (error: any) {
    console.error("Failed to create lesson:", error);
    res.status(500).json({ error: "Failed to create lesson plan: " + error.message });
  }
});

// AI LESSON PLAN GENERATOR (Syllabus Aligned)
app.post("/api/lessons/generate", async (req, res) => {
  const { syllabusId, title, topic, duration, teacherName, customDirectives } = req.body;
  
  try {
    let syllabusContextPrompt = "";
    let subject = "";
    let classLevel = "";

    // 1. Fetch Syllabus alignment metadata from Neon
    if (syllabusId) {
      const syllabusRes = await pool.query("SELECT * FROM syllabi WHERE id = $1", [syllabusId]);
      if (syllabusRes.rows.length > 0) {
        const syllabus = syllabusRes.rows[0];
        subject = syllabus.subject || "";
        classLevel = syllabus.class_level || "";
        const meta = syllabus.extracted_metadata || {};
        
        syllabusContextPrompt = `
          ALIGNED MINESEC SYLLABUS:
          Subject: ${subject}
          Class Level: ${classLevel}
          Official Competencies: ${JSON.stringify(meta.competencies || [])}
          Official Learning Outcomes: ${JSON.stringify(meta.learningOutcomes || [])}
          Syllabus Modules/Chapters: ${JSON.stringify(meta.modules || [])}
          Assessment criteria: ${JSON.stringify(meta.assessmentCriteria || [])}
        `;
      }
    }

    if (!ai) {
      throw new Error("Gemini AI API Key is not configured.");
    }

    // 2. Build CBA Aligned Lesson Plan Prompt
    const lessonPrompt = `
      You are an expert AI Curriculum Designer and Pedagogy Specialist in the Cameroon Ministry of Secondary Education (MINESEC).
      Generate an exceptionally engaging, comprehensive, and detailed lesson plan aligned with the Competency-Based Approach (CBA).
      
      Topic: ${topic}
      Lesson Title: ${title}
      Duration: ${duration || "2 Hours"}
      Teacher Name: ${teacherName || "Minesec Teacher"}
      Custom Pedagogical Directives: ${customDirectives || "None"}
      
      ${syllabusContextPrompt}

      Requirements under MINESEC CBA Standard:
      1. Define targeted Competencies precisely.
      2. Define specific Learning Objectives (Cognitive, Psychomotor, Affective).
      3. Map prerequisite knowledge/skills (Prerequisites).
      4. Detail the pedagogical process step-by-step:
         - Introduction & Brainstorming (Motivate & Hook): Include a lively, student-centered "Hook" or puzzle using relatable real-world Cameroonian examples.
         - Core lesson content & structured knowledge development.
         - Application / Guided Activities / Practical Exercise (Critical in Technical/General CBA): Design interactive student-led tasks, gamified class challenges, or hands-on simulations that keep the classroom lively.
         - Consolidation & Conclusion: Summarize key takeaways with positive, encouraging teacher messages.
      5. Include Assessment Data (Formative diagnostic questions or quiz, summative exercises, evaluation grids).
      
      CRITICAL ENGAGEMENT GUIDELINES:
      - Use lively, student-friendly, and highly encouraging language.
      - Incorporate rich local Cameroonian context, local names (e.g. Amadou, Chi, Brenda, Ngo), local industries, or landmarks.
      - Add creative "💡 Active Classroom Pause" check-in blocks where students pair up, discuss, or practice a quick challenge together.
      
      You must respond strictly with a JSON object formatted as follows (without markdown wrappers):
      {
        "title": "Lesson title",
        "subject": "Subject name",
        "classLevel": "Targeted Class Level",
        "competencyMapping": {
          "coreCompetency": "Core competency targeted from the syllabus",
          "learningOutcome": "Expected learning outcome aligned with syllabus outcomes"
        },
        "learningObjectives": ["Specific objective 1", "Specific objective 2"],
        "lessonContent": "Richly detailed Markdown content for the lesson structure, including introduction, step-by-step body, guided exercises, practical tasks, and teacher summary.",
        "assessmentData": {
          "evaluationQuestions": ["Question 1", "Question 2", "Question 3"],
          "assessmentCriteria": ["Accuracy", "Understanding of CBA principles", "Practical application correctness"]
        }
      }
    `;

    const response = await generateContentWithFallback({
      contents: lessonPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            subject: { type: Type.STRING },
            classLevel: { type: Type.STRING },
            competencyMapping: {
              type: Type.OBJECT,
              properties: {
                coreCompetency: { type: Type.STRING },
                learningOutcome: { type: Type.STRING },
              },
              required: ["coreCompetency", "learningOutcome"],
            },
            learningObjectives: { type: Type.ARRAY, items: { type: Type.STRING } },
            lessonContent: { type: Type.STRING },
            assessmentData: {
              type: Type.OBJECT,
              properties: {
                evaluationQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                assessmentCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["evaluationQuestions", "assessmentCriteria"],
            },
          },
          required: ["title", "subject", "competencyMapping", "learningObjectives", "lessonContent", "assessmentData"],
        },
      },
    });

    const parsedLesson = JSON.parse(response.text?.trim() || "{}");

    // 3. Save the newly AI-generated lesson to the database as a draft
    const insertQuery = `
      INSERT INTO lessons (title, subject, class_level, duration, syllabus_id, status, teacher_name, competency_mapping, learning_objectives, lesson_content, assessment_data, metadata, version)
      VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, 1)
      RETURNING *
    `;

    const values = [
      parsedLesson.title,
      parsedLesson.subject || subject,
      parsedLesson.classLevel || classLevel,
      duration || "2 Hours",
      syllabusId || null,
      teacherName || "Minesec Teacher",
      JSON.stringify(parsedLesson.competencyMapping),
      JSON.stringify(parsedLesson.learningObjectives),
      parsedLesson.lessonContent,
      JSON.stringify(parsedLesson.assessmentData),
      JSON.stringify({ customDirectives, generatedByAI: true }),
    ];

    const dbResult = await pool.query(insertQuery, values);
    const newLesson = dbResult.rows[0];

    // Create historic backup for version 1
    await pool.query(
      `INSERT INTO lesson_history (lesson_id, version, title, lesson_content, competency_mapping, learning_objectives) VALUES ($1, 1, $2, $3, $4, $5)`,
      [newLesson.id, newLesson.title, newLesson.lesson_content, JSON.stringify(newLesson.competency_mapping), JSON.stringify(newLesson.learning_objectives)]
    );

    res.status(201).json(newLesson);
  } catch (error: any) {
    console.error("AI Generation failed:", error);
    res.status(500).json({ error: error.message || "Failed to generate CBA Lesson plan." });
  }
});

// Update an existing Lesson Plan (Supports Save Draft, Publish, Auto-save, and creates new versions on substantial change)
app.put("/api/lessons/:id", async (req, res) => {
  const { id } = req.params;
  const { title, subject, class_level, duration, syllabus_id, status, teacher_name, competency_mapping, learning_objectives, lesson_content, assessment_data, metadata, create_new_version } = req.body;

  try {
    // 1. Fetch current version and state
    const currentRes = await pool.query("SELECT * FROM lessons WHERE id = $1", [id]);
    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: "Lesson not found" });
    }
    const currentLesson = currentRes.rows[0];
    let nextVersion = currentLesson.version || 1;

    if (create_new_version) {
      nextVersion += 1;
    }

    // 2. Perform database update
    const updateQuery = `
      UPDATE lessons 
      SET title = $1, subject = $2, class_level = $3, duration = $4, syllabus_id = $5, status = $6, teacher_name = $7, 
          competency_mapping = $8, learning_objectives = $9, lesson_content = $10, assessment_data = $11, metadata = $12, version = $13, updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING *
    `;

    const updatedResult = await pool.query(updateQuery, [
      title || currentLesson.title,
      subject !== undefined ? subject : currentLesson.subject,
      class_level !== undefined ? class_level : currentLesson.class_level,
      duration !== undefined ? duration : currentLesson.duration,
      syllabus_id !== undefined ? syllabus_id : currentLesson.syllabus_id,
      status !== undefined ? status : currentLesson.status,
      teacher_name !== undefined ? teacher_name : currentLesson.teacher_name,
      competency_mapping ? JSON.stringify(competency_mapping) : JSON.stringify(currentLesson.competency_mapping),
      learning_objectives ? JSON.stringify(learning_objectives) : JSON.stringify(currentLesson.learning_objectives),
      lesson_content !== undefined ? lesson_content : currentLesson.lesson_content,
      assessment_data ? JSON.stringify(assessment_data) : JSON.stringify(currentLesson.assessment_data),
      metadata ? JSON.stringify(metadata) : JSON.stringify(currentLesson.metadata),
      nextVersion,
      id,
    ]);

    const updatedLesson = updatedResult.rows[0];

    // 3. If new version is triggered, record it in history
    if (create_new_version) {
      await pool.query(
        `INSERT INTO lesson_history (lesson_id, version, title, lesson_content, competency_mapping, learning_objectives) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, nextVersion, updatedLesson.title, updatedLesson.lesson_content, JSON.stringify(updatedLesson.competency_mapping), JSON.stringify(updatedLesson.learning_objectives)]
      );
    }

    res.json(updatedLesson);
  } catch (error: any) {
    console.error("Failed to update lesson:", error);
    res.status(500).json({ error: "Failed to update lesson: " + error.message });
  }
});

// Restore previous version of a lesson
app.post("/api/lessons/:id/restore/:versionId", async (req, res) => {
  const { id, versionId } = req.params;
  try {
    const historyRes = await pool.query("SELECT * FROM lesson_history WHERE lesson_id = $1 AND id = $2", [id, versionId]);
    if (historyRes.rows.length === 0) {
      return res.status(404).json({ error: "Version not found" });
    }
    const historic = historyRes.rows[0];

    // Fetch the lesson to find current version number, increment it
    const lessonRes = await pool.query("SELECT version FROM lessons WHERE id = $1", [id]);
    const nextVersion = (lessonRes.rows[0]?.version || 1) + 1;

    // Update lesson with historic fields
    const updateQuery = `
      UPDATE lessons 
      SET title = $1, lesson_content = $2, competency_mapping = $3, learning_objectives = $4, version = $5, updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
    `;
    const updated = await pool.query(updateQuery, [
      historic.title,
      historic.lesson_content,
      JSON.stringify(historic.competency_mapping),
      JSON.stringify(historic.learning_objectives),
      nextVersion,
      id,
    ]);

    // Save this restored state as a new historic backup version
    await pool.query(
      `INSERT INTO lesson_history (lesson_id, version, title, lesson_content, competency_mapping, learning_objectives) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, nextVersion, historic.title, historic.lesson_content, JSON.stringify(historic.competency_mapping), JSON.stringify(historic.learning_objectives)]
    );

    res.json(updated.rows[0]);
  } catch (error: any) {
    console.error("Failed to restore lesson version:", error);
    res.status(500).json({ error: "Failed to restore lesson version: " + error.message });
  }
});

// Duplicate Lesson
app.post("/api/lessons/:id/duplicate", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM lessons WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lesson not found" });
    }
    const o = result.rows[0];

    const insertQuery = `
      INSERT INTO lessons (title, subject, class_level, duration, syllabus_id, status, teacher_name, competency_mapping, learning_objectives, lesson_content, assessment_data, metadata, version)
      VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, 1)
      RETURNING *
    `;

    const dbResult = await pool.query(insertQuery, [
      o.title + " (Copy)",
      o.subject,
      o.class_level,
      o.duration,
      o.syllabus_id,
      o.teacher_name,
      JSON.stringify(o.competency_mapping),
      JSON.stringify(o.learning_objectives),
      o.lesson_content,
      JSON.stringify(o.assessment_data),
      JSON.stringify({ ...o.metadata, duplicatedFrom: id }),
    ]);

    const dup = dbResult.rows[0];

    // Initial version history
    await pool.query(
      `INSERT INTO lesson_history (lesson_id, version, title, lesson_content, competency_mapping, learning_objectives) VALUES ($1, 1, $2, $3, $4, $5)`,
      [dup.id, dup.title, dup.lesson_content, JSON.stringify(dup.competency_mapping), JSON.stringify(dup.learning_objectives)]
    );

    res.status(201).json(dup);
  } catch (error: any) {
    console.error("Failed to duplicate lesson:", error);
    res.status(500).json({ error: "Failed to duplicate lesson plan" });
  }
});

// Delete Lesson Plan
app.delete("/api/lessons/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("DELETE FROM lessons WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lesson not found" });
    }
    res.json({ message: "Lesson plan deleted successfully", deleted: result.rows[0] });
  } catch (error: any) {
    console.error("Failed to delete lesson plan:", error);
    res.status(500).json({ error: "Failed to delete lesson plan" });
  }
});

// ==========================================
// IMAGE UPLOAD & QUIZ RESULTS APIs
// ==========================================

// Upload image to Cloudinary (returns optimized secure URL)
app.post("/api/upload-image", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file was provided." });
  }

  const filePath = req.file.path;

  try {
    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      throw new Error("Cloudinary credentials are not configured on the server.");
    }

    // Upload to Cloudinary with compression & format auto-optimizations
    const result: any = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload(
        filePath,
        {
          resource_type: "image",
          folder: "minesec_images",
          transformation: [
            { quality: "auto:good", fetch_format: "auto" }
          ]
        },
        (error, uploadResult) => {
          if (error) reject(error);
          else resolve(uploadResult);
        }
      );
    });

    res.json({
      url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format
    });
  } catch (error: any) {
    console.error("Cloudinary upload failed:", error);
    res.status(500).json({ error: "Image upload failed: " + (error.message || error) });
  } finally {
    // Clean up local temp file
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error("Failed to delete temp file:", e);
      }
    }
  }
});

// Save a student quiz evaluation result
app.post("/api/quiz-results", async (req, res) => {
  const { quizId, studentName, score, total, percentage, answers } = req.body;
  try {
    const query = `
      INSERT INTO quiz_results (quiz_id, student_name, score, total, percentage, answers)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await pool.query(query, [
      quizId,
      studentName || "Minesec Student",
      score,
      total,
      percentage,
      JSON.stringify(answers || {})
    ]);
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    console.error("Failed to save quiz result:", error);
    res.status(500).json({ error: "Failed to save evaluation: " + error.message });
  }
});

// Get all quiz results (Teacher/Admin dashboard view)
app.get("/api/quiz-results", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, q.title as quiz_title, q.subject, q.class_level 
      FROM quiz_results r
      JOIN quizzes q ON r.quiz_id = q.id
      ORDER BY r.created_at DESC
    `);
    res.json(result.rows);
  } catch (error: any) {
    console.error("Failed to fetch quiz results:", error);
    res.status(500).json({ error: "Failed to fetch results: " + error.message });
  }
});

// Get quiz results for a specific quiz
app.get("/api/quiz-results/quiz/:quizId", async (req, res) => {
  const { quizId } = req.params;
  try {
    const result = await pool.query(`
      SELECT * FROM quiz_results 
      WHERE quiz_id = $1 
      ORDER BY created_at DESC
    `, [quizId]);
    res.json(result.rows);
  } catch (error: any) {
    console.error("Failed to fetch results for quiz:", error);
    res.status(500).json({ error: "Failed to fetch results: " + error.message });
  }
});

// ==========================================
// LECTURE NOTES GENERATOR APIs
// ==========================================

// Get all lectures
app.get("/api/lectures", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM lectures ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error: any) {
    console.error("Failed to fetch lectures:", error);
    res.status(500).json({ error: "Failed to fetch lectures: " + error.message });
  }
});

// Generate AI Lecture notes
app.post("/api/lectures/generate", async (req, res) => {
  const { syllabusId, topic, formatDetail, subject, classLevel, customDirectives } = req.body;
  try {
    let syllabusContextPrompt = "";
    let finalSubject = subject || "";
    let finalClassLevel = classLevel || "";

    if (syllabusId) {
      const syllabusRes = await pool.query("SELECT * FROM syllabi WHERE id = $1", [syllabusId]);
      if (syllabusRes.rows.length > 0) {
        const syllabus = syllabusRes.rows[0];
        finalSubject = syllabus.subject || finalSubject;
        finalClassLevel = syllabus.class_level || finalClassLevel;
        const meta = syllabus.extracted_metadata || {};
        
        syllabusContextPrompt = `
          ALIGNED MINESEC SYLLABUS DETAILS:
          Subject: ${finalSubject}
          Class Level: ${finalClassLevel}
          Official Competencies: ${JSON.stringify(meta.competencies || [])}
          Official Learning Outcomes: ${JSON.stringify(meta.learningOutcomes || [])}
          Syllabus Modules/Chapters: ${JSON.stringify(meta.modules || [])}
        `;
      }
    }

    if (!ai) {
      throw new Error("Gemini AI API Key is not configured.");
    }

    const lecturePrompt = `
      You are an expert AI Educator, Curriculum Developer, and Pedagogy Specialist specializing in the Cameroon Ministry of Secondary Education (MINESEC) standard.
      Generate an exceptionally engaging, highly comprehensive, detailed, and academically rigorous lecture note or textbook-quality content based on the provided topic.

      Topic: ${topic}
      Subject: ${finalSubject}
      Class Level: ${finalClassLevel}
      Detail Level required: ${formatDetail || "Comprehensive"}
      
      ${syllabusContextPrompt}
      Custom Guidelines & Directives: ${customDirectives || "None"}

      Requirements:
      1. Write clear, structured content using standard Markdown.
      2. Keep explanations theoretically sound, explaining formulas, core proofs, or definitions beautifully.
      3. Use relevant local Cameroonian examples, context, or illustrations (e.g. Cameroonian industries, regional agricultural products, local architecture, or currency) to make it highly engaging and context-aware.
      4. Incorporate highly encouraging and supportive language throughout to make the classroom feel lively. Add engaging periodic callout cards inside the markdown like:
         - **💡 CBA Active Thinker Check**: A quick thought-provoking question for students.
         - **⭐ Pro-Tip**: To keep students excited and validated.
      5. Include:
         - A clean introductory section (Motivate and hook the student with real-world applications)
         - Core Concepts and Definitions
         - In-depth lecture body (subsections, headings, formulas, tables, bullet points)
         - Worked Examples (step-by-step encouraging solutions)
         - Practical work / Exercises for students to solve
         - A structured summary of key takeaways (using encouraging words)
         - Suggested further readings.
      
      You must respond strictly with a JSON object formatted as follows:
      {
        "title": "Lecture Title",
        "subject": "Subject Name",
        "classLevel": "Class Level",
        "content": "Detailed Lecture notes in beautifully formatted Markdown."
      }
    `;

    const response = await generateContentWithFallback({
      contents: lecturePrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            subject: { type: Type.STRING },
            classLevel: { type: Type.STRING },
            content: { type: Type.STRING }
          },
          required: ["title", "subject", "classLevel", "content"]
        }
      }
    });

    const parsedLecture = JSON.parse(response.text?.trim() || "{}");

    const insertQuery = `
      INSERT INTO lectures (title, topic, subject, class_level, syllabus_id, content, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [
      parsedLecture.title,
      topic,
      parsedLecture.subject || finalSubject,
      parsedLecture.classLevel || finalClassLevel,
      syllabusId ? Number(syllabusId) : null,
      parsedLecture.content,
      JSON.stringify({ formatDetail, generatedByAI: true, customDirectives })
    ];

    const dbResult = await pool.query(insertQuery, values);
    res.status(201).json(dbResult.rows[0]);
  } catch (error: any) {
    console.error("AI Lecture Generation failed:", error);
    res.status(500).json({ error: error.message || "Failed to generate AI lecture notes." });
  }
});

// Delete Lecture
app.delete("/api/lectures/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("DELETE FROM lectures WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lecture not found" });
    }
    res.json({ message: "Lecture deleted successfully", deleted: result.rows[0] });
  } catch (error: any) {
    console.error("Failed to delete lecture:", error);
    res.status(500).json({ error: "Failed to delete lecture" });
  }
});

// Update Lecture
app.put("/api/lectures/:id", async (req, res) => {
  const { id } = req.params;
  const { title, topic, subject, class_level, content, metadata } = req.body;
  try {
    const query = `
      UPDATE lectures 
      SET title = $1, topic = $2, subject = $3, class_level = $4, content = $5, metadata = $6
      WHERE id = $7
      RETURNING *
    `;
    const values = [
      title,
      topic,
      subject,
      class_level,
      content,
      typeof metadata === "string" ? metadata : JSON.stringify(metadata || {}),
      id
    ];
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lecture not found" });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    console.error("Failed to update lecture:", error);
    res.status(500).json({ error: "Failed to update lecture notes: " + error.message });
  }
});

// ==========================================
// QUIZ GENERATOR APIs
// ==========================================

// Get all quizzes
app.get("/api/quizzes", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM quizzes ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error: any) {
    console.error("Failed to fetch quizzes:", error);
    res.status(500).json({ error: "Failed to fetch quizzes: " + error.message });
  }
});

// Generate AI Quiz
app.post("/api/quizzes/generate", async (req, res) => {
  const { syllabusId, lessonId, topic, numQuestions, questionType, difficulty, subject, classLevel, customDirectives } = req.body;
  try {
    let syllabusContextPrompt = "";
    let lessonContextPrompt = "";
    let finalSubject = subject || "";
    let finalClassLevel = classLevel || "";

    if (syllabusId) {
      const syllabusRes = await pool.query("SELECT * FROM syllabi WHERE id = $1", [syllabusId]);
      if (syllabusRes.rows.length > 0) {
        const syllabus = syllabusRes.rows[0];
        finalSubject = syllabus.subject || finalSubject;
        finalClassLevel = syllabus.class_level || finalClassLevel;
        const meta = syllabus.extracted_metadata || {};
        
        syllabusContextPrompt = `
          ALIGNED MINESEC SYLLABUS DETAILS:
          Subject: ${finalSubject}
          Class Level: ${finalClassLevel}
          Official Competencies: ${JSON.stringify(meta.competencies || [])}
          Official Learning Outcomes: ${JSON.stringify(meta.learningOutcomes || [])}
        `;
      }
    }

    if (lessonId) {
      const lessonRes = await pool.query("SELECT * FROM lessons WHERE id = $1", [lessonId]);
      if (lessonRes.rows.length > 0) {
        const lesson = lessonRes.rows[0];
        finalSubject = lesson.subject || finalSubject;
        finalClassLevel = lesson.class_level || finalClassLevel;
        lessonContextPrompt = `
          ALIGNED LESSON PLAN OBJECTIVES: ${JSON.stringify(lesson.learning_objectives || [])}
          LESSON PLAN CONTENT EXCERPT: ${lesson.lesson_content ? lesson.lesson_content.substring(0, 5000) : ""}
        `;
      }
    }

    if (!ai) {
      throw new Error("Gemini AI API Key is not configured.");
    }

    const quizPrompt = `
      You are an expert AI Evaluator and Pedagogy Specialist specializing in the Cameroon Ministry of Secondary Education (MINESEC) Competency Based Approach (CBA).
      Generate an exceptionally engaging, professional, and rigorous evaluation quiz based on the following context.

      Topic: ${topic}
      Subject: ${finalSubject}
      Class Level: ${finalClassLevel}
      Number of Questions: ${numQuestions || 5}
      Question Type format: ${questionType || "Mixed"} (Use MCQ for Multiple Choice, TF for True/False, SA for Short Answer)
      CBA Difficulty/Cognitive level: ${difficulty || "Recall & Application"} (Focus on MINESEC cognitive levels: Recall/Knowledge, Application/Solving, Analysis/Synthesis/Evaluation)
      
      ${syllabusContextPrompt}
      ${lessonContextPrompt}
      Custom Directives & Guidelines: ${customDirectives || "None"}

      CRITICAL ENGAGEMENT GUIDELINES:
      - Design evaluation questions that are highly interesting, realistic, and scenario-based (e.g. "Brenda is building a bridge in Limbe...", "Amadou is auditing a cocoa drying farm in Bafoussam...").
      - Make the question tone lively and encouraging.
      - Ensure the explanation field contains highly supportive, positive, and educational feedback (e.g. starts with "Awesome choice! This validates..." or "Great effort! Remember that...").

      Format your response strictly as a JSON object with the following schema:
      {
        "title": "Quiz Title",
        "subject": "Subject Name",
        "classLevel": "Class Level",
        "difficulty": "Cognitive Level",
        "questions": [
          {
            "id": 1,
            "type": "MCQ", // MUST be "MCQ" or "TF" or "SA"
            "question": "A complete, professionally written evaluation question",
            "options": ["Option A", "Option B", "Option C", "Option D"], // MUST have exactly 4 items for MCQ. For TF, MUST have ["True", "False"]. For SA, leave empty []
            "correctAnswer": "A", // Option letter 'A', 'B', 'C', 'D' for MCQ. 'True' or 'False' for TF. Clear answer word or phrase for SA.
            "explanation": "Constructive CBA alignment explanation starting with encouraging words and explaining why the answer is correct."
          }
        ]
      }
    `;

    const response = await generateContentWithFallback({
      contents: quizPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            subject: { type: Type.STRING },
            classLevel: { type: Type.STRING },
            difficulty: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER },
                  type: { type: Type.STRING },
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  correctAnswer: { type: Type.STRING },
                  explanation: { type: Type.STRING }
                },
                required: ["id", "type", "question", "options", "correctAnswer", "explanation"]
              }
            }
          },
          required: ["title", "subject", "classLevel", "difficulty", "questions"]
        }
      }
    });

    const parsedQuiz = JSON.parse(response.text?.trim() || "{}");

    const insertQuery = `
      INSERT INTO quizzes (title, topic, syllabus_id, lesson_id, questions, difficulty, class_level, subject)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [
      parsedQuiz.title,
      topic,
      syllabusId ? Number(syllabusId) : null,
      lessonId ? Number(lessonId) : null,
      JSON.stringify(parsedQuiz.questions),
      parsedQuiz.difficulty || difficulty,
      parsedQuiz.classLevel || finalClassLevel,
      parsedQuiz.subject || finalSubject
    ];

    const dbResult = await pool.query(insertQuery, values);
    res.status(201).json(dbResult.rows[0]);
  } catch (error: any) {
    console.error("AI Quiz Generation failed:", error);
    res.status(500).json({ error: error.message || "Failed to generate AI quiz." });
  }
});

// Delete Quiz
app.delete("/api/quizzes/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("DELETE FROM quizzes WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Quiz not found" });
    }
    res.json({ message: "Quiz deleted successfully", deleted: result.rows[0] });
  } catch (error: any) {
    console.error("Failed to delete quiz:", error);
    res.status(500).json({ error: "Failed to delete quiz" });
  }
});

// ==========================================
// VITE CLIENT DEV MIDDLEWARE & DIST STATIC
// ==========================================

let dbInitialized = false;
app.use(async (req, res, next) => {
  if (!dbInitialized) {
    try {
      const cleanedUrl = getCleanedDatabaseUrl();
      if (cleanedUrl) {
        await initDatabase();
      } else {
        console.log("[Database] DATABASE_URL is not set. Operating in local JSON database mode.");
        if (!(pool instanceof JsonDb)) {
          pool = new JsonDb();
        }
      }
      dbInitialized = true;
    } catch (err) {
      console.error("Delayed database initialization failed:", err);
      console.log("[Database] Falling back to local JSON database mode due to initialization failure.");
      pool = new JsonDb();
      dbInitialized = true;
    }
  }
  next();
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`MINESEC Academic Co-Pilot server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
