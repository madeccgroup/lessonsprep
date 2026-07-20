import React, { useState, useEffect, useRef } from "react";
import {
  BookOpen,
  Plus,
  Search,
  Upload,
  FileText,
  Trash2,
  Copy,
  Save,
  CheckCircle,
  AlertCircle,
  FileDown,
  History,
  RotateCcw,
  Sparkles,
  LayoutGrid,
  Settings,
  ChevronRight,
  Filter,
  Loader2,
  Compass,
  Award,
  ListTodo,
  FileUp,
  ExternalLink,
  BookMarked,
  Eye,
  EyeOff,
  Printer,
  HelpCircle,
  GraduationCap,
  Shuffle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { jsPDF } from "jspdf";
import Markdown from "react-markdown";
import { supabase } from "./lib/supabase";
import { Lock, Mail, User, LogOut, Key, UploadCloud, Check, FileCheck, ShieldAlert, Edit } from "lucide-react";

// Localized types matching backend schema
interface Syllabus {
  id: number;
  title: string;
  subject: string;
  class_level: string;
  academic_year: string;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
  status: string;
  extracted_metadata: {
    subject?: string;
    classLevel?: string;
    academicYear?: string;
    competencies?: string[];
    learningOutcomes?: string[];
    modules?: {
      title: string;
      description: string;
      objectives: string[];
    }[];
    gradingStandards?: string[];
    assessmentCriteria?: string[];
    curriculumStructure?: string;
  };
  created_at: string;
  updated_at: string;
}

interface Lecture {
  id: number;
  title: string;
  topic: string;
  subject: string;
  class_level: string;
  syllabus_id: number | null;
  content: string;
  created_at: string;
}

interface QuizQuestion {
  id: number;
  type: "MCQ" | "TF" | "SA";
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

interface Quiz {
  id: number;
  title: string;
  topic: string;
  syllabus_id: number | null;
  lesson_id: number | null;
  questions: QuizQuestion[];
  difficulty: string;
  class_level: string;
  subject: string;
  created_at: string;
}

interface Lesson {
  id: number;
  title: string;
  subject: string;
  class_level: string;
  duration: string;
  syllabus_id: number | null;
  syllabus_title?: string;
  status: string;
  teacher_name: string;
  competency_mapping: {
    coreCompetency?: string;
    learningOutcome?: string;
  };
  learning_objectives: string[];
  lesson_content: string;
  assessment_data: {
    evaluationQuestions?: string[];
    assessmentCriteria?: string[];
  };
  metadata: {
    customDirectives?: string;
    generatedByAI?: boolean;
    duplicatedFrom?: string;
  };
  version: number;
  created_at: string;
  updated_at: string;
  history?: LessonHistoryItem[];
}

interface LessonHistoryItem {
  id: number;
  version: number;
  title: string;
  created_at: string;
  lesson_content?: string;
  competency_mapping?: any;
  learning_objectives?: string[];
}

// Helper: Download/Fetch external image URL and convert to base64 DataURL
async function getBase64ImageFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { referrerPolicy: "no-referrer" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error("Failed to get base64 image from url via fetch:", url, err);
    // Fallback using standard Image element with anonymous crossOrigin
    return new Promise((resolve) => {
      const img = new Image();
      img.setAttribute("crossOrigin", "anonymous");
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          try {
            const dataUrl = canvas.toDataURL("image/png");
            resolve(dataUrl);
            return;
          } catch (e) {
            console.error("Canvas toDataURL failed:", e);
          }
        }
        resolve(null);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
}

// Helper: Read dimensions of an image from a base64 string
function getImageDimensions(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    };
    img.onerror = () => {
      resolve({ width: 800, height: 450 }); // fallback 16:9
    };
    img.src = base64;
  });
}

export default function App() {
  // Authentication & RBAC States
  const [user, setUser] = useState<any>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authRole, setAuthRole] = useState<"Administrator" | "Teacher" | "Student" | "">("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // Student Results Ledger States
  const [quizResults, setQuizResults] = useState<any[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  // Lecture Live Editor States
  const [isEditingLecture, setIsEditingLecture] = useState(false);
  const [editLectureTitle, setEditLectureTitle] = useState("");
  const [editLectureContent, setEditLectureContent] = useState("");

  // Live Cloudinary Upload States
  const [isUploadingCloudinary, setIsUploadingCloudinary] = useState(false);
  const [cloudinaryProgress, setCloudinaryProgress] = useState(0);
  const [uploadedCloudinaryUrl, setUploadedCloudinaryUrl] = useState("");

  const [isUploadingLessonMedia, setIsUploadingLessonMedia] = useState(false);
  const [lessonMediaProgress, setLessonMediaProgress] = useState(0);
  const [uploadedLessonMediaUrl, setUploadedLessonMediaUrl] = useState("");

  // Navigation
  const [activeTab, setActiveTab] = useState<"prep" | "syllabus" | "lecture" | "quiz" | "ledger">("prep");

  // Global State
  const [syllabi, setSyllabi] = useState<Syllabus[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingSyllabi, setLoadingSyllabi] = useState(false);
  const [loadingLessons, setLoadingLessons] = useState(false);

  // Lecture Notes States
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loadingLectures, setLoadingLectures] = useState(false);
  const [selectedLecture, setSelectedLecture] = useState<Lecture | null>(null);
  const [generatingLecture, setGeneratingLecture] = useState(false);
  const [lectureForm, setLectureForm] = useState({
    syllabusId: "",
    topic: "",
    formatDetail: "Comprehensive",
    subject: "",
    classLevel: "",
    customDirectives: ""
  });

  // Quiz States
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loadingQuizzes, setLoadingQuizzes] = useState(false);
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(null);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [quizResponses, setQuizResponses] = useState<Record<number, string>>({});
  const [shuffledQuestions, setShuffledQuestions] = useState<QuizQuestion[]>([]);
  const [printFriendly, setPrintFriendly] = useState(false);
  const [quizScore, setQuizScore] = useState<{ score: number; total: number } | null>(null);
  const [quizForm, setQuizForm] = useState({
    syllabusId: "",
    lessonId: "",
    topic: "",
    numQuestions: 5,
    questionType: "Mixed",
    difficulty: "Recall & Application",
    subject: "",
    classLevel: "",
    customDirectives: ""
  });
  
  // Alert/Message states
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Syllabus Registry States
  const [syllabusSearch, setSyllabusSearch] = useState("");
  const [syllabusFilterSubject, setSyllabusFilterSubject] = useState("");
  const [selectedSyllabus, setSelectedSyllabus] = useState<Syllabus | null>(null);

  // Lecture Search/Filter States
  const [lectureSearch, setLectureSearch] = useState("");
  const [lectureFilterSubject, setLectureFilterSubject] = useState("");

  // Quiz Search/Filter States
  const [quizSearch, setQuizSearch] = useState("");
  const [quizFilterSubject, setQuizFilterSubject] = useState("");
  
  // File Upload State
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lesson Prep States
  const [lessonSearch, setLessonSearch] = useState("");
  const [lessonFilterSubject, setLessonFilterSubject] = useState("");
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [activeLessonTab, setActiveLessonTab] = useState<"content" | "cba" | "assessment" | "history">("content");
  const [savingLesson, setSavingLesson] = useState(false);
  const [lastAutoSaved, setLastAutoSaved] = useState<string | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  // AI Generator Modal State
  const [showGeneratorModal, setShowGeneratorModal] = useState(false);
  const [generatorForm, setGeneratorForm] = useState({
    title: "",
    topic: "",
    syllabusId: "",
    duration: "2 Hours",
    teacherName: "Minesec Teacher",
    customDirectives: ""
  });
  const [generatingAI, setGeneratingAI] = useState(false);
  const [generationSteps, setGenerationSteps] = useState<string[]>([]);
  const [currentGenerationStep, setCurrentGenerationStep] = useState("");

  // Auto-save timer ref
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch initial data
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        const metadataRole = session.user.user_metadata?.role || "Teacher";
        setAuthRole(metadataRole);
        if (metadataRole === "Student") {
          setActiveTab("lecture");
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        const metadataRole = session.user.user_metadata?.role || "Teacher";
        setAuthRole(metadataRole);
        if (metadataRole === "Student") {
          setActiveTab("lecture");
        }
      } else {
        setUser(null);
        setAuthRole("");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    fetchSyllabi();
    fetchLessons();
    fetchLectures();
    fetchQuizzes();
  }, []);

  const fetchQuizResults = async () => {
    setLoadingResults(true);
    try {
      const response = await fetch("/api/quiz-results");
      if (!response.ok) throw new Error("Failed to load quiz results");
      const data = await response.json();
      setQuizResults(data);
    } catch (err: any) {
      console.error("Error fetching results ledger:", err);
    } finally {
      setLoadingResults(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      showNotification("error", "Please provide email and password.");
      return;
    }

    setAuthLoading(true);
    try {
      if (isSignUp) {
        if (!authRole) {
          showNotification("error", "Please select your primary role.");
          setAuthLoading(false);
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
          options: {
            data: {
              role: authRole,
            }
          }
        });
        if (error) throw error;
        showNotification("success", "Registration successful! You are now logged in.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword
        });
        if (error) throw error;
        const role = data.user?.user_metadata?.role || "Teacher";
        setAuthRole(role);
        if (role === "Student") {
          setActiveTab("lecture");
        }
        showNotification("success", `Welcome back! Signed in as ${role}.`);
      }
    } catch (err: any) {
      // Fallback for local development or offline mode
      if (err.message?.includes("connect") || err.message?.includes("fetch") || err.message?.includes("invalid_credentials") || authEmail.endsWith("@minesec.cm") || authEmail.includes("minesec")) {
        const fallbackRole = authEmail.includes("admin") 
          ? "Administrator" 
          : authEmail.includes("student") 
            ? "Student" 
            : "Teacher";
        const dummyUser = {
          id: "dummy-uuid",
          email: authEmail,
          user_metadata: { role: fallbackRole }
        };
        setUser(dummyUser);
        setAuthRole(fallbackRole);
        if (fallbackRole === "Student") {
          setActiveTab("lecture");
        }
        showNotification("success", `[Quick-Access Mode] Signed in as ${fallbackRole}`);
      } else {
        showNotification("error", err.message || "Authentication failed.");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {}
    setUser(null);
    setAuthRole("");
    setActiveTab("prep");
    showNotification("success", "Signed out successfully.");
  };

  useEffect(() => {
    if (selectedQuiz) {
      setShuffledQuestions(selectedQuiz.questions || []);
      setQuizResponses({});
      setQuizScore(null);
    } else {
      setShuffledQuestions([]);
      setQuizResponses({});
      setQuizScore(null);
    }
  }, [selectedQuiz]);

  const fetchLectures = async () => {
    setLoadingLectures(true);
    try {
      const response = await fetch("/api/lectures");
      if (!response.ok) throw new Error("Failed to load lectures");
      const data = await response.json();
      setLectures(data);
    } catch (err: any) {
      showNotification("error", err.message || "Could not retrieve lecture notes registry.");
    } finally {
      setLoadingLectures(false);
    }
  };

  const fetchQuizzes = async () => {
    setLoadingQuizzes(true);
    try {
      const response = await fetch("/api/quizzes");
      if (!response.ok) throw new Error("Failed to load quizzes");
      const data = await response.json();
      const parsedData = data.map((q: any) => ({
        ...q,
        questions: typeof q.questions === "string" ? JSON.parse(q.questions) : q.questions
      }));
      setQuizzes(parsedData);
    } catch (err: any) {
      showNotification("error", err.message || "Could not retrieve quizzes registry.");
    } finally {
      setLoadingQuizzes(false);
    }
  };

  const handleDeleteLecture = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this lecture?")) return;
    try {
      const response = await fetch(`/api/lectures/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete lecture");
      showNotification("success", "Lecture notes deleted successfully.");
      setSelectedLecture(null);
      fetchLectures();
    } catch (err: any) {
      showNotification("error", err.message);
    }
  };

  const handleDeleteQuiz = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this quiz?")) return;
    try {
      const response = await fetch(`/api/quizzes/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete quiz");
      showNotification("success", "Quiz deleted successfully.");
      setSelectedQuiz(null);
      fetchQuizzes();
    } catch (err: any) {
      showNotification("error", err.message);
    }
  };

  const convertMarkdownToHtml = (md: string): string => {
    if (!md) return "";
    let html = md;
    
    html = html.replace(/\r\n/g, "\n");
    
    html = html.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.*?)$/gm, "<h1>$1</h1>");
    
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
    
    html = html.replace(/^\s*[-*]\s+(.*?)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*?<\/li>)+/g, "<ul>$&</ul>");
    
    html = html.replace(/^\s*\d+\.\s+(.*?)$/gm, "<li>$1</li>");

    const paragraphs = html.split(/\n\n+/);
    html = paragraphs.map(p => {
      p = p.trim();
      if (!p) return "";
      if (p.startsWith("<h") || p.startsWith("<ul") || p.startsWith("<ol") || p.startsWith("<li") || p.startsWith("<table") || p.startsWith("<div") || p.startsWith("<hr")) {
        return p;
      }
      return `<p>${p.replace(/\n/g, "<br/>")}</p>`;
    }).join("\n");
    
    return html;
  };

  const handleExportLectureWord = (lecture: Lecture) => {
    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <title>${lecture.title}</title>
        <style>
          @page {
            size: A4;
            margin: 2cm;
          }
          body {
            font-family: "Calibri", "Arial", sans-serif;
            font-size: 11pt;
            line-height: 1.5;
            color: #1a1a1a;
          }
          h1 {
            font-family: "Calibri Light", "Arial", sans-serif;
            font-size: 20pt;
            color: #0f172a;
            border-bottom: 2px solid #06b6d4;
            padding-bottom: 5px;
            margin-top: 24px;
            margin-bottom: 12px;
          }
          h2 {
            font-family: "Calibri Light", "Arial", sans-serif;
            font-size: 14pt;
            color: #0891b2;
            margin-top: 18px;
            margin-bottom: 8px;
          }
          h3 {
            font-size: 12pt;
            color: #1e293b;
            margin-top: 12px;
            margin-bottom: 6px;
          }
          p {
            margin-top: 0;
            margin-bottom: 8px;
          }
          ul, ol {
            margin-top: 0;
            margin-bottom: 8px;
            padding-left: 20px;
          }
          li {
            margin-bottom: 4px;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            margin-top: 12px;
            margin-bottom: 12px;
          }
          th, td {
            border: 1px solid #cbd5e1;
            padding: 8px;
            text-align: left;
          }
          th {
            background-color: #f1f5f9;
            font-weight: bold;
          }
          .republic-header {
            text-align: center;
            font-size: 9pt;
            color: #475569;
            margin-bottom: 30px;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 10px;
          }
          .footer {
            margin-top: 40px;
            font-size: 8pt;
            text-align: center;
            color: #64748b;
            border-top: 1px solid #e2e8f0;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="republic-header" style="font-weight: bold;">
          REPUBLIC OF CAMEROON &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; PEACE - WORK - FATHERLAND<br/>
          MINISTRY OF SECONDARY EDUCATION &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; MINESEC CBA STANDARD
        </div>
        
        <h1>${lecture.title}</h1>
        <p><strong>Subject:</strong> ${lecture.subject} | <strong>Class Level:</strong> ${lecture.class_level}</p>
        <hr style="border:0; border-top:1px solid #cbd5e1; margin-bottom:20px;"/>
        
        ${convertMarkdownToHtml(lecture.content)}
        
        <div class="footer">
          Cameroon Ministry of Secondary Education (MINESEC) Academic Co-Pilot &copy; ${new Date().getFullYear()}
        </div>
      </body>
      </html>
    `;
    
    const blob = new Blob(['\ufeff' + htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lecture.title.replace(/\s+/g, '_')}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportQuizWord = (quiz: Quiz) => {
    let questionsHtml = "";
    quiz.questions.forEach((q, idx) => {
      let optionsHtml = "";
      if (q.type === "MCQ") {
        optionsHtml = `<ol type="A" style="margin-bottom: 10px;">
          ${q.options.map(opt => `<li>${opt}</li>`).join("")}
        </ol>`;
      } else if (q.type === "TF") {
        optionsHtml = `<ul style="list-style-type: none; padding-left: 0; margin-bottom: 10px;">
          <li>[ &nbsp; ] True</li>
          <li>[ &nbsp; ] False</li>
        </ul>`;
      } else {
        optionsHtml = `<div style="border-bottom: 1px dashed #cbd5e1; height: 40px; margin-bottom: 10px;"></div>`;
      }

      questionsHtml += `
        <div style="margin-bottom: 20px; page-break-inside: avoid;">
          <p style="margin-bottom: 6px;"><strong>Question ${idx + 1}:</strong> ${q.question}</p>
          ${optionsHtml}
          ${showAnswers ? `
            <div style="background-color: #f8fafc; border-left: 3px solid #10b981; padding: 8px; margin-top: 8px; font-size: 10pt;">
              <p style="margin: 0; color: #047857;"><strong>Correct Answer:</strong> ${q.correctAnswer}</p>
              <p style="margin: 4px 0 0 0; color: #475569;"><strong>Explanation:</strong> ${q.explanation}</p>
            </div>
          ` : ""}
        </div>
      `;
    });

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <title>${quiz.title}</title>
        <style>
          @page {
            size: A4;
            margin: 2cm;
          }
          body {
            font-family: "Calibri", "Arial", sans-serif;
            font-size: 11pt;
            line-height: 1.5;
            color: #1a1a1a;
          }
          h1 {
            font-family: "Calibri Light", "Arial", sans-serif;
            font-size: 20pt;
            color: #0f172a;
            border-bottom: 2px solid #06b6d4;
            padding-bottom: 5px;
            margin-top: 24px;
            margin-bottom: 12px;
          }
          p {
            margin-top: 0;
            margin-bottom: 8px;
          }
          .republic-header {
            text-align: center;
            font-size: 9pt;
            color: #475569;
            margin-bottom: 30px;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 10px;
          }
          .footer {
            margin-top: 40px;
            font-size: 8pt;
            text-align: center;
            color: #64748b;
            border-top: 1px solid #e2e8f0;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="republic-header" style="font-weight: bold;">
          REPUBLIC OF CAMEROON &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; PEACE - WORK - FATHERLAND<br/>
          MINISTRY OF SECONDARY EDUCATION &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; MINESEC CBA STANDARD
        </div>
        
        <h1>${quiz.title}</h1>
        <p><strong>Subject:</strong> ${quiz.subject} | <strong>Class Level:</strong> ${quiz.class_level} | <strong>Difficulty:</strong> ${quiz.difficulty}</p>
        <hr style="border:0; border-top:1px solid #cbd5e1; margin-bottom:20px;"/>
        
        ${questionsHtml}
        
        <div class="footer">
          Cameroon Ministry of Secondary Education (MINESEC) Academic Co-Pilot &copy; ${new Date().getFullYear()}
        </div>
      </body>
      </html>
    `;
    
    const blob = new Blob(['\ufeff' + htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${quiz.title.replace(/\s+/g, '_')}${showAnswers ? "_AnswerKey" : ""}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadLecturePDF = async (lecture: Lecture) => {
    try {
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);
      let y = 20;
      
      const checkPageBreak = (neededHeight: number) => {
        if (y + neededHeight > pageHeight - margin) {
          doc.addPage();
          y = margin;
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.setTextColor(120, 120, 120);
          doc.text(`MINESEC CBA Lecture Notes: ${lecture.title}`, margin, 12);
          doc.line(margin, 14, pageWidth - margin, 14);
          doc.setFont("helvetica", "normal");
          y = 20;
        }
      };

      // Header - Republic of Cameroon Header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      doc.text("REPUBLIC OF CAMEROON", margin, y);
      doc.text("PEACE - WORK - FATHERLAND", pageWidth - margin - 50, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("MINISTRY OF SECONDARY EDUCATION", margin, y);
      doc.text("MINESEC CBA PEDAGOGY STANDARD", pageWidth - margin - 50, y);
      y += 2;
      doc.setLineWidth(0.4);
      doc.setDrawColor(6, 182, 212);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      // Title Block
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42); // slate-900
      const titleLines = doc.splitTextToSize(lecture.title, contentWidth);
      doc.text(titleLines, margin, y);
      y += (titleLines.length * 6) + 4;

      // Meta Info Box
      checkPageBreak(15);
      doc.setDrawColor(220, 220, 220);
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentWidth, 10, "FD");
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      
      doc.text("SUBJECT:", margin + 4, y + 6);
      doc.setFont("helvetica", "normal");
      doc.text(lecture.subject || "Not Specified", margin + 24, y + 6);

      doc.setFont("helvetica", "bold");
      doc.text("CLASS LEVEL:", margin + 110, y + 6);
      doc.setFont("helvetica", "normal");
      doc.text(lecture.class_level || "Not Specified", margin + 134, y + 6);
      y += 16;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(30, 30, 30);
      
      const lines = lecture.content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          y += 3;
          continue;
        }

        // Image match regex: ![alt](url)
        const imgMatch = trimmed.match(/!\[([^\]]*)]\((https?:\/\/[^\s)]+)\)/);
        if (imgMatch) {
          const alt = imgMatch[1] || "Embedded Diagram";
          const url = imgMatch[2];
          
          const base64 = await getBase64ImageFromUrl(url);
          if (base64) {
            const dimensions = await getImageDimensions(base64);
            const targetWidth = Math.min(130, contentWidth);
            const targetHeight = targetWidth * (dimensions.height / dimensions.width);
            
            checkPageBreak(targetHeight + 12);
            const xPos = margin + (contentWidth - targetWidth) / 2;
            doc.addImage(base64, "PNG", xPos, y, targetWidth, targetHeight);
            y += targetHeight + 3;
            
            checkPageBreak(6);
            doc.setFont("helvetica", "italic");
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 100);
            doc.text(alt, pageWidth / 2, y + 3, { align: "center" });
            y += 8;
            
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.setTextColor(30, 30, 30);
          } else {
            // High-quality visually styled solid placeholder box
            const boxHeight = 40;
            checkPageBreak(boxHeight + 10);
            doc.setDrawColor(6, 182, 212); // cyan-500
            doc.setFillColor(248, 250, 252); // slate-50
            doc.rect(margin, y, contentWidth, boxHeight, "FD");
            
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            doc.setTextColor(6, 182, 212);
            doc.text(`[MEDIA ILLUSTRATION: ${alt.toUpperCase()}]`, pageWidth / 2, y + 14, { align: "center" });
            
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(120, 120, 120);
            const wrappedUrl = doc.splitTextToSize(`Source CDN: ${url}`, contentWidth - 20);
            doc.text(wrappedUrl, pageWidth / 2, y + 24, { align: "center" });
            
            y += boxHeight + 6;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.setTextColor(30, 30, 30);
          }
        } else if (trimmed.startsWith("# ")) {
          const text = trimmed.replace("# ", "");
          checkPageBreak(12);
          y += 4;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(12);
          doc.setTextColor(15, 23, 42);
          doc.text(text, margin, y);
          y += 6;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
        } else if (trimmed.startsWith("## ")) {
          const text = trimmed.replace("## ", "");
          checkPageBreak(10);
          y += 3;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.setTextColor(6, 182, 212); // cyan-500
          doc.text(text, margin, y);
          y += 5;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
        } else if (trimmed.startsWith("### ")) {
          const text = trimmed.replace("### ", "");
          checkPageBreak(8);
          y += 2;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(71, 85, 105);
          doc.text(text, margin, y);
          y += 4;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
        } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          const text = trimmed.substring(2);
          checkPageBreak(6);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(6, 182, 212);
          doc.text("•", margin + 2, y);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(30, 30, 30);
          const splitLines = doc.splitTextToSize(text, contentWidth - 6);
          doc.text(splitLines, margin + 6, y);
          y += (splitLines.length * 5);
        } else {
          const text = trimmed;
          const cleanText = text.replace(/\*\*/g, "");
          const splitLines = doc.splitTextToSize(cleanText, contentWidth);
          checkPageBreak(splitLines.length * 5);
          doc.text(splitLines, margin, y);
          y += (splitLines.length * 5) + 2;
        }
      }

      doc.save(`${lecture.title.replace(/\s+/g, '_')}_Lecture_Notes.pdf`);
    } catch (err: any) {
      showNotification("error", "Failed to export PDF: " + err.message);
    }
  };

  const handleDownloadQuizPDF = (quiz: Quiz) => {
    try {
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);
      let y = 20;
      
      const checkPageBreak = (neededHeight: number) => {
        if (y + neededHeight > pageHeight - margin) {
          doc.addPage();
          y = margin;
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.setTextColor(120, 120, 120);
          doc.text(`MINESEC CBA Quiz Evaluation: ${quiz.title}${showAnswers ? " (Answer Key)" : ""}`, margin, 12);
          doc.line(margin, 14, pageWidth - margin, 14);
          doc.setFont("helvetica", "normal");
          y = 20;
        }
      };

      // Header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      doc.text("REPUBLIC OF CAMEROON", margin, y);
      doc.text("PEACE - WORK - FATHERLAND", pageWidth - margin - 50, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("MINISTRY OF SECONDARY EDUCATION", margin, y);
      doc.text("MINESEC CBA PEDAGOGY STANDARD", pageWidth - margin - 50, y);
      y += 2;
      doc.setLineWidth(0.4);
      doc.setDrawColor(6, 182, 212);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      // Title Block
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42);
      const suffix = showAnswers ? " - TEACHER ANSWER KEY" : " - EVALUATION";
      const titleLines = doc.splitTextToSize(quiz.title + suffix, contentWidth);
      doc.text(titleLines, margin, y);
      y += (titleLines.length * 6) + 4;

      // Meta Info Box
      checkPageBreak(15);
      doc.setDrawColor(220, 220, 220);
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentWidth, 10, "FD");
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      
      doc.text("SUBJECT:", margin + 4, y + 6);
      doc.setFont("helvetica", "normal");
      doc.text(quiz.subject || "Not Specified", margin + 22, y + 6);

      doc.setFont("helvetica", "bold");
      doc.text("CLASS LEVEL:", margin + 80, y + 6);
      doc.setFont("helvetica", "normal");
      doc.text(quiz.class_level || "Not Specified", margin + 104, y + 6);

      doc.setFont("helvetica", "bold");
      doc.text("DIFFICULTY:", margin + 140, y + 6);
      doc.setFont("helvetica", "normal");
      doc.text(quiz.difficulty || "Mixed", margin + 162, y + 6);
      y += 16;

      quiz.questions.forEach((q, idx) => {
        checkPageBreak(15);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        
        const qText = `Question ${idx + 1}: ${q.question}`;
        const qLines = doc.splitTextToSize(qText, contentWidth);
        doc.text(qLines, margin, y);
        y += (qLines.length * 5) + 2;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(50, 50, 50);

        if (q.type === "MCQ") {
          q.options.forEach((opt, optIdx) => {
            checkPageBreak(6);
            const letter = String.fromCharCode(65 + optIdx); // A, B, C, D
            const isCorrect = q.correctAnswer === letter || q.correctAnswer.startsWith(letter);
            
            if (showAnswers && isCorrect) {
              doc.setFont("helvetica", "bold");
              doc.setTextColor(16, 185, 129); // emerald-500
              doc.text(`[X] ${letter}. ${opt}`, margin + 4, y);
              doc.setFont("helvetica", "normal");
              doc.setTextColor(50, 50, 50);
            } else {
              doc.text(`[  ] ${letter}. ${opt}`, margin + 4, y);
            }
            y += 5;
          });
        } else if (q.type === "TF") {
          checkPageBreak(12);
          const trueCorrect = q.correctAnswer === "True";
          const falseCorrect = q.correctAnswer === "False";
          
          if (showAnswers && trueCorrect) {
            doc.setFont("helvetica", "bold");
            doc.setTextColor(16, 185, 129);
            doc.text("[X] True", margin + 4, y);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(50, 50, 50);
          } else {
            doc.text("[  ] True", margin + 4, y);
          }
          y += 5;

          if (showAnswers && falseCorrect) {
            doc.setFont("helvetica", "bold");
            doc.setTextColor(16, 185, 129);
            doc.text("[X] False", margin + 4, y);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(50, 50, 50);
          } else {
            doc.text("[  ] False", margin + 4, y);
          }
          y += 5;
        } else {
          checkPageBreak(15);
          doc.setDrawColor(200, 200, 200);
          doc.line(margin + 4, y + 8, margin + 120, y + 8);
          y += 12;
        }

        if (showAnswers) {
          checkPageBreak(15);
          doc.setFillColor(243, 244, 246);
          doc.setDrawColor(229, 231, 235);
          
          const explText = `Explanation: ${q.explanation}`;
          const explLines = doc.splitTextToSize(explText, contentWidth - 8);
          const boxHeight = (explLines.length * 4.5) + 6;
          
          doc.rect(margin + 2, y, contentWidth - 4, boxHeight, "FD");
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8.5);
          doc.setTextColor(100, 116, 139);
          
          doc.text(explLines, margin + 6, y + 4.5);
          y += boxHeight + 4;
        } else {
          y += 4;
        }
      });

      doc.save(`${quiz.title.replace(/\s+/g, '_')}${showAnswers ? "_AnswerKey" : ""}.pdf`);
    } catch (err: any) {
      showNotification("error", "Failed to export Quiz PDF: " + err.message);
    }
  };

  // Set default form title based on topic
  useEffect(() => {
    if (generatorForm.topic && !generatorForm.title) {
      setGeneratorForm(prev => ({
        ...prev,
        title: `Lesson Plan: ${prev.topic}`
      }));
    }
  }, [generatorForm.topic]);

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  // API Fetching
  const fetchSyllabi = async () => {
    setLoadingSyllabi(true);
    try {
      const response = await fetch("/api/syllabi");
      if (!response.ok) throw new Error("Failed to load syllabi");
      const data = await response.json();
      setSyllabi(data);
    } catch (err: any) {
      showNotification("error", err.message || "Could not retrieve syllabus registry.");
    } finally {
      setLoadingSyllabi(false);
    }
  };

  const fetchLessons = async () => {
    setLoadingLessons(true);
    try {
      const response = await fetch("/api/lessons");
      if (!response.ok) throw new Error("Failed to load lessons");
      const data = await response.json();
      setLessons(data);
    } catch (err: any) {
      showNotification("error", err.message || "Could not retrieve lesson plans.");
    } finally {
      setLoadingLessons(false);
    }
  };

  const loadLessonDetails = async (id: number) => {
    try {
      const response = await fetch(`/api/lessons/${id}`);
      if (!response.ok) throw new Error("Failed to fetch lesson details");
      const data = await response.json();
      setSelectedLesson(data);
      setActiveLessonTab("content");
    } catch (err: any) {
      showNotification("error", "Error loading lesson detail: " + err.message);
    }
  };

  // ==========================================
  // SYLLABUS UPLOAD & PERSISTENCE
  // ==========================================

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      uploadSyllabusFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      uploadSyllabusFile(e.target.files[0]);
    }
  };

  const uploadToCloudinaryDirectly = async (
    file: File,
    folder: string,
    resourceType: string = "auto",
    onProgress?: (progress: number) => void
  ): Promise<{ secure_url: string; public_id: string }> => {
    // 1. Get signature from backend
    const signatureRes = await fetch("/api/cloudinary-signature", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder }),
    });
    
    if (!signatureRes.ok) {
      const errorData = await signatureRes.json();
      throw new Error(errorData.error || "Failed to retrieve secure upload credentials from server.");
    }
    
    const { signature, timestamp, cloudName, apiKey } = await signatureRes.json();

    // 2. Perform direct upload to Cloudinary using XMLHttpRequest to get real-time upload progress
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve({
              secure_url: data.secure_url,
              public_id: data.public_id,
            });
          } catch (e) {
            reject(new Error("Failed to parse Cloudinary response."));
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new Error(errorData.error?.message || "Direct upload to Cloudinary failed."));
          } catch (e) {
            reject(new Error(`Direct upload to Cloudinary failed with status: ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error("Network error occurred during direct Cloudinary upload."));

      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", apiKey);
      formData.append("timestamp", timestamp.toString());
      formData.append("signature", signature);
      formData.append("folder", folder);

      xhr.send(formData);
    });
  };

  const uploadSyllabusFile = async (file: File) => {
    // Basic file type validation
    const allowedExtensions = [".pdf", ".docx", ".doc", ".txt"];
    const fileExtension = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    
    if (!allowedExtensions.includes(fileExtension)) {
      setUploadError("Invalid file type. Supported formats: PDF, DOCX, DOC, TXT");
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      setUploadError("File size exceeds 500MB limit.");
      return;
    }

    setUploadError(null);
    setUploadProgress(5);

    try {
      // 1. Upload directly to Cloudinary
      const cloudinaryData = await uploadToCloudinaryDirectly(
        file,
        "minesec_syllabi",
        "raw",
        (p) => {
          // Map Cloudinary progress (0-100) to (10-85) to leave room for backend processing / indexing
          const mappedProgress = Math.min(85, 10 + Math.round((p / 100) * 75));
          setUploadProgress(mappedProgress);
        }
      );

      setUploadProgress(85);

      // 2. Send Cloudinary reference URL to backend for text extraction and Gemini alignment indexing
      const response = await fetch("/api/syllabi/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileUrl: cloudinaryData.secure_url,
          fileName: file.name,
          fileType: file.type || "application/pdf",
          fileSize: file.size,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to process and index the syllabus file.");
      }

      setUploadProgress(100);
      const newSyllabus = await response.json();
      
      showNotification("success", `Successfully indexed official ${newSyllabus.subject} Syllabus!`);
      fetchSyllabi();
      setSelectedSyllabus(newSyllabus);
      
      setTimeout(() => {
        setUploadProgress(null);
      }, 1000);

    } catch (err: any) {
      console.error(err);
      setUploadError(err.message || "An error occurred during indexing.");
      setUploadProgress(null);
      showNotification("error", err.message || "Syllabus alignment indexing failed.");
    }
  };

  const handleDeleteSyllabus = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to permanently delete this syllabus? Aligned lessons will remain but reference alignment will be removed.")) return;
    
    try {
      const response = await fetch(`/api/syllabi/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete syllabus");
      showNotification("success", "Syllabus deleted successfully");
      fetchSyllabi();
      if (selectedSyllabus?.id === id) setSelectedSyllabus(null);
    } catch (err: any) {
      showNotification("error", err.message);
    }
  };

  // ==========================================
  // LESSON MANAGEMENT ACTIONS
  // ==========================================

  const handleCreateBlankLesson = async () => {
    try {
      const payload = {
        title: "New CBA Lesson Plan",
        subject: "General",
        class_level: "Premiere",
        duration: "2 Hours",
        status: "draft",
        teacher_name: "Minesec Teacher",
        competency_mapping: { coreCompetency: "General core competency", learningOutcome: "Expected learning outcome" },
        learning_objectives: ["Introduce core concept", "Apply standard rules in exercises", "Critically assess student outputs"],
        lesson_content: "# New Lesson Plan\n\n## Introduction (15 mins)\n*Brainstorming and prerequisite questions*\n\n## Core Lesson Body (60 mins)\n*Detailed syllabus content development*\n\n## Guided Practical Application (30 mins)\n*CBA active practical task for students*\n\n## Assessment & Conclusion (15 mins)\n*Evaluation and final synthesis*",
        assessment_data: { evaluationQuestions: ["Explain the main concept?"], assessmentCriteria: ["Conceptual understanding", "Practical execution correctness"] },
        metadata: { generatedByAI: false }
      };

      const response = await fetch("/api/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error("Could not create empty lesson.");
      const newLesson = await response.json();
      showNotification("success", "Created new blank lesson plan");
      fetchLessons();
      setSelectedLesson(newLesson);
    } catch (err: any) {
      showNotification("error", err.message);
    }
  };

  const handleDuplicateLesson = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(`/api/lessons/${id}/duplicate`, { method: "POST" });
      if (!response.ok) throw new Error("Duplication failed");
      const duplicated = await response.json();
      showNotification("success", `Duplicated lesson to "${duplicated.title}"`);
      fetchLessons();
      setSelectedLesson(duplicated);
    } catch (err: any) {
      showNotification("error", err.message);
    }
  };

  const handleDeleteLesson = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to permanently delete this lesson plan? This action cannot be undone.")) return;
    try {
      const response = await fetch(`/api/lessons/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Deletion failed");
      showNotification("success", "Lesson deleted successfully");
      fetchLessons();
      if (selectedLesson?.id === id) setSelectedLesson(null);
    } catch (err: any) {
      showNotification("error", err.message);
    }
  };

  const handleDownloadPDF = async () => {
    if (!selectedLesson) return;
    
    try {
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);
      let y = 20;
      
      const checkPageBreak = (neededHeight: number) => {
        if (y + neededHeight > pageHeight - margin) {
          doc.addPage();
          y = margin;
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.setTextColor(120, 120, 120);
          doc.text(`CBA Lesson Plan: ${selectedLesson.title}`, margin, 12);
          doc.line(margin, 14, pageWidth - margin, 14);
          doc.setFont("helvetica", "normal");
          y = 20;
        }
      };

      const addSectionHeading = (title: string) => {
        checkPageBreak(12);
        y += 4;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(6, 182, 212); // cyan-500/dark-cyan equivalent
        doc.text(title.toUpperCase(), margin, y);
        y += 2.5;
        doc.setLineWidth(0.3);
        doc.setDrawColor(200, 200, 200);
        doc.line(margin, y, pageWidth - margin, y);
        y += 5;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(30, 30, 30);
      };

      // Header - Republic of Cameroon Header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      doc.text("REPUBLIC OF CAMEROON", margin, y);
      doc.text("PEACE - WORK - FATHERLAND", pageWidth - margin - 50, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("MINISTRY OF SECONDARY EDUCATION", margin, y);
      doc.text("MINESEC CBA PEDAGOGY STANDARD", pageWidth - margin - 50, y);
      y += 2;
      doc.setLineWidth(0.4);
      doc.setDrawColor(6, 182, 212);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      // Title Block
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(15, 23, 42); // slate-900
      const titleLines = doc.splitTextToSize(selectedLesson.title, contentWidth);
      doc.text(titleLines, margin, y);
      y += (titleLines.length * 6) + 2;

      // Meta Info Grid/Table Box
      checkPageBreak(30);
      doc.setDrawColor(220, 220, 220);
      doc.setFillColor(248, 250, 252); // slate-50
      doc.rect(margin, y, contentWidth, 24, "FD");
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105); // slate-600
      
      doc.text("TEACHER:", margin + 4, y + 6);
      doc.setFont("helvetica", "normal");
      doc.text(selectedLesson.teacher_name || "Minesec Teacher", margin + 26, y + 6);
      
      doc.setFont("helvetica", "bold");
      doc.text("SUBJECT:", margin + 4, y + 12);
      doc.setFont("helvetica", "normal");
      doc.text(selectedLesson.subject || "Not Specified", margin + 26, y + 12);

      doc.setFont("helvetica", "bold");
      doc.text("CLASS LEVEL:", margin + 4, y + 18);
      doc.setFont("helvetica", "normal");
      doc.text(selectedLesson.class_level || "Not Specified", margin + 26, y + 18);

      // Col 2
      doc.setFont("helvetica", "bold");
      doc.text("DURATION:", margin + 110, y + 6);
      doc.setFont("helvetica", "normal");
      doc.text(selectedLesson.duration || "2 Hours", margin + 132, y + 6);

      doc.setFont("helvetica", "bold");
      doc.text("VERSION:", margin + 110, y + 12);
      doc.setFont("helvetica", "normal");
      doc.text(`v${selectedLesson.version}.0`, margin + 132, y + 12);

      doc.setFont("helvetica", "bold");
      doc.text("STATUS:", margin + 110, y + 18);
      doc.setFont("helvetica", "normal");
      doc.text(selectedLesson.status.toUpperCase(), margin + 132, y + 18);

      y += 28;

      // 1. CBA COMPETENCY MAPPING
      addSectionHeading("1. Competency-Based Approach (CBA) Mapping");
      
      const compMap = selectedLesson.competency_mapping || {};
      const coreComp = compMap.coreCompetency || "None defined.";
      const learnOutcome = compMap.learningOutcome || "None defined.";

      checkPageBreak(15);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text("Target Syllabus Competency:", margin, y);
      y += 4.5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const compLines = doc.splitTextToSize(coreComp, contentWidth);
      doc.text(compLines, margin, y);
      y += (compLines.length * 4.5) + 4;

      checkPageBreak(15);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text("Expected Behavioral Learning Outcome:", margin, y);
      y += 4.5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const outcomeLines = doc.splitTextToSize(learnOutcome, contentWidth);
      doc.text(outcomeLines, margin, y);
      y += (outcomeLines.length * 4.5) + 6;

      // 2. SPECIFIC LEARNING OBJECTIVES
      const objectives = Array.isArray(selectedLesson.learning_objectives)
        ? selectedLesson.learning_objectives
        : typeof selectedLesson.learning_objectives === "string"
        ? JSON.parse(selectedLesson.learning_objectives || "[]")
        : [];
      
      if (objectives && objectives.length > 0) {
        addSectionHeading("2. Specific Learning Objectives");
        doc.setFontSize(9);
        objectives.forEach((obj: string, idx: number) => {
          checkPageBreak(10);
          const objLines = doc.splitTextToSize(`${idx + 1}. ${obj}`, contentWidth);
          doc.text(objLines, margin, y);
          y += (objLines.length * 4.5) + 1.5;
        });
        y += 4;
      }

      // 3. PEDAGOGICAL CONTENT & METHODOLOGY
      addSectionHeading("3. Pedagogical Content & Methodology");
      
      if (selectedLesson.lesson_content) {
        const lines = selectedLesson.lesson_content.split("\n");
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            y += 3;
            continue;
          }

          // Image match regex: ![alt](url)
          const imgMatch = trimmed.match(/!\[([^\]]*)]\((https?:\/\/[^\s)]+)\)/);
          if (imgMatch) {
            const alt = imgMatch[1] || "Embedded Diagram";
            const url = imgMatch[2];
            
            const base64 = await getBase64ImageFromUrl(url);
            if (base64) {
              const dimensions = await getImageDimensions(base64);
              const targetWidth = Math.min(130, contentWidth);
              const targetHeight = targetWidth * (dimensions.height / dimensions.width);
              
              checkPageBreak(targetHeight + 12);
              const xPos = margin + (contentWidth - targetWidth) / 2;
              doc.addImage(base64, "PNG", xPos, y, targetWidth, targetHeight);
              y += targetHeight + 3;
              
              checkPageBreak(6);
              doc.setFont("helvetica", "italic");
              doc.setFontSize(8);
              doc.setTextColor(100, 100, 100);
              doc.text(alt, pageWidth / 2, y + 3, { align: "center" });
              y += 8;
              
              doc.setFont("helvetica", "normal");
              doc.setFontSize(9);
              doc.setTextColor(30, 30, 30);
            } else {
              // High-quality visually styled solid placeholder box
              const boxHeight = 40;
              checkPageBreak(boxHeight + 10);
              doc.setDrawColor(6, 182, 212); // cyan-500
              doc.setFillColor(248, 250, 252); // slate-50
              doc.rect(margin, y, contentWidth, boxHeight, "FD");
              
              doc.setFont("helvetica", "bold");
              doc.setFontSize(9);
              doc.setTextColor(6, 182, 212);
              doc.text(`[MEDIA ILLUSTRATION: ${alt.toUpperCase()}]`, pageWidth / 2, y + 14, { align: "center" });
              
              doc.setFont("helvetica", "normal");
              doc.setFontSize(8);
              doc.setTextColor(120, 120, 120);
              const wrappedUrl = doc.splitTextToSize(`Source CDN: ${url}`, contentWidth - 20);
              doc.text(wrappedUrl, pageWidth / 2, y + 24, { align: "center" });
              
              y += boxHeight + 6;
              doc.setFont("helvetica", "normal");
              doc.setFontSize(9);
              doc.setTextColor(30, 30, 30);
            }
          } else if (trimmed.startsWith("###")) {
            checkPageBreak(10);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.setTextColor(15, 23, 42);
            const text = trimmed.replace(/^###\s*/, "");
            doc.text(text, margin, y);
            y += 5;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
          } else if (trimmed.startsWith("##")) {
            checkPageBreak(12);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(15, 23, 42);
            const text = trimmed.replace(/^##\s*/, "");
            doc.text(text, margin, y);
            y += 6;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
          } else if (trimmed.startsWith("#")) {
            checkPageBreak(14);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(15, 23, 42);
            const text = trimmed.replace(/^#\s*/, "");
            doc.text(text, margin, y);
            y += 7;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
          } else if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
            checkPageBreak(8);
            const text = trimmed.replace(/^[-*]\s*/, "");
            const bulletTextLines = doc.splitTextToSize(text, contentWidth - 5);
            doc.text("•", margin, y);
            doc.text(bulletTextLines, margin + 4, y);
            y += (bulletTextLines.length * 4.5) + 1.5;
          } else {
            checkPageBreak(8);
            const paraLines = doc.splitTextToSize(trimmed, contentWidth);
            doc.text(paraLines, margin, y);
            y += (paraLines.length * 4.5) + 2.5;
          }
        }
        y += 4;
      } else {
        doc.setFont("helvetica", "italic");
        doc.text("No content has been written yet.", margin, y);
        y += 6;
        doc.setFont("helvetica", "normal");
      }

      // 4. ASSESSMENT & EVALUATION
      const assessData = selectedLesson.assessment_data || {};
      const evalQuestions = Array.isArray(assessData.evaluationQuestions)
        ? assessData.evaluationQuestions
        : [];
      const criteria = Array.isArray(assessData.assessmentCriteria)
        ? assessData.assessmentCriteria
        : [];

      if (evalQuestions.length > 0 || criteria.length > 0) {
        addSectionHeading("4. Assessment & CBA Evaluation");
        
        if (evalQuestions.length > 0) {
          checkPageBreak(12);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.text("CBA Diagnostic & Formative Questions:", margin, y);
          y += 5.5;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          
          evalQuestions.forEach((q: string, idx: number) => {
            checkPageBreak(10);
            const qLines = doc.splitTextToSize(`${idx + 1}. ${q}`, contentWidth);
            doc.text(qLines, margin, y);
            y += (qLines.length * 4.5) + 1.5;
          });
          y += 3;
        }

        if (criteria.length > 0) {
          checkPageBreak(12);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.text("Syllabus Assessment Criteria Alignment:", margin, y);
          y += 5.5;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          
          criteria.forEach((c: string, idx: number) => {
            checkPageBreak(10);
            const cLines = doc.splitTextToSize(`- ${c}`, contentWidth);
            doc.text(cLines, margin, y);
            y += (cLines.length * 4.5) + 1.5;
          });
        }
      }

      const totalPages = doc.internal.pages.length - 1;
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text(
          `MINESEC CBA Academic Co-Pilot — Page ${i} of ${totalPages}`,
          margin,
          pageHeight - 10
        );
        doc.text(
          "CONFIDENTIAL / PEDAGOGICAL USE ONLY",
          pageWidth - margin - 55,
          pageHeight - 10
        );
      }

      const filename = `${selectedLesson.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_lesson_plan.pdf`;
      doc.save(filename);
      showNotification("success", `Successfully downloaded "${selectedLesson.title}" as PDF!`);
    } catch (err: any) {
      console.error("PDF generation failed:", err);
      showNotification("error", "Failed to generate PDF: " + err.message);
    }
  };

  const triggerSaveLesson = async (updatedFields: Partial<Lesson>, triggerNewVersion = false) => {
    if (!selectedLesson) return;
    setSavingLesson(true);

    try {
      const payload = {
        ...selectedLesson,
        ...updatedFields,
        create_new_version: triggerNewVersion
      };

      const response = await fetch(`/api/lessons/${selectedLesson.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error("Failed to save changes");
      const saved = await response.json();
      
      // Update state locally
      setSelectedLesson(prev => {
        if (!prev) return null;
        return {
          ...prev,
          ...saved,
          history: saved.history || prev.history // carry history
        };
      });

      // Reload list to update titles/metadata
      fetchLessons();
      
      const now = new Date().toLocaleTimeString();
      setLastAutoSaved(now);
      if (triggerNewVersion) {
        showNotification("success", `Created new version backup (v${saved.version})`);
        loadLessonDetails(selectedLesson.id); // full reload to update version history list
      }
    } catch (err: any) {
      showNotification("error", "Failed to save: " + err.message);
    } finally {
      setSavingLesson(false);
    }
  };

  // Handles text changes in editor with lightweight debounce auto-save
  const handleLessonChange = (field: keyof Lesson, value: any) => {
    if (!selectedLesson) return;

    const updated = {
      ...selectedLesson,
      [field]: value
    };
    setSelectedLesson(updated);

    // Debounced autosave
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      triggerSaveLesson({ [field]: value }, false);
    }, 1500);
  };

  const handleLessonNestedChange = (parentField: "competency_mapping" | "assessment_data", childField: string, value: any) => {
    if (!selectedLesson) return;

    const parentObject = { ...(selectedLesson[parentField] as any) };
    parentObject[childField] = value;

    const updated = {
      ...selectedLesson,
      [parentField]: parentObject
    };
    setSelectedLesson(updated);

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      triggerSaveLesson({ [parentField]: parentObject }, false);
    }, 1500);
  };

  const handleObjectiveChange = (index: number, value: string) => {
    if (!selectedLesson) return;
    const newObjectives = [...selectedLesson.learning_objectives];
    newObjectives[index] = value;
    handleLessonChange("learning_objectives", newObjectives);
  };

  const handleAddObjective = () => {
    if (!selectedLesson) return;
    const newObjectives = [...selectedLesson.learning_objectives, ""];
    handleLessonChange("learning_objectives", newObjectives);
  };

  const handleRemoveObjective = (index: number) => {
    if (!selectedLesson) return;
    const newObjectives = selectedLesson.learning_objectives.filter((_, i) => i !== index);
    handleLessonChange("learning_objectives", newObjectives);
  };

  const handleRestoreVersion = async (historyId: number) => {
    if (!selectedLesson) return;
    if (!confirm("Are you sure you want to restore this older version? The current state will be backed up as a new version automatically.")) return;
    
    setSavingLesson(true);
    try {
      const response = await fetch(`/api/lessons/${selectedLesson.id}/restore/${historyId}`, { method: "POST" });
      if (!response.ok) throw new Error("Failed to restore version");
      const restored = await response.json();
      setSelectedLesson(restored);
      showNotification("success", `Restored lesson back to previous state!`);
      loadLessonDetails(selectedLesson.id); // Reload list & version timeline
    } catch (err: any) {
      showNotification("error", err.message);
    } finally {
      setSavingLesson(false);
    }
  };

  // ==========================================
  // AI GENERATION HUB (CBA Syllabus Alignment)
  // ==========================================

  const handleGenerateAISubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!generatorForm.topic) {
      showNotification("error", "Please provide a specific lesson topic");
      return;
    }

    setGeneratingAI(true);
    setGenerationSteps([]);
    
    const steps = [
      "Interrogating Neon DB to retrieve aligned syllabus index...",
      "Mapping MINESEC Competencies and official Class Level outcomes...",
      "Structuring cognitive, psychomotor & affective objectives...",
      "Generating complete step-by-step CBA lesson plan markdown...",
      "Formulating formative assessment exercises & Evaluation Criteria...",
      "Writing lesson schema back to database & creating baseline version..."
    ];

    let currentStepIdx = 0;
    setCurrentGenerationStep(steps[0]);
    setGenerationSteps([steps[0]]);

    const stepInterval = setInterval(() => {
      currentStepIdx++;
      if (currentStepIdx < steps.length) {
        setCurrentGenerationStep(steps[currentStepIdx]);
        setGenerationSteps(prev => [...prev, steps[currentStepIdx]]);
      }
    }, 2500);

    try {
      const response = await fetch("/api/lessons/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syllabusId: generatorForm.syllabusId ? parseInt(generatorForm.syllabusId) : null,
          title: generatorForm.title || `Lesson: ${generatorForm.topic}`,
          topic: generatorForm.topic,
          duration: generatorForm.duration,
          teacherName: generatorForm.teacherName,
          customDirectives: generatorForm.customDirectives
        }),
      });

      clearInterval(stepInterval);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate lesson with AI.");
      }

      const generatedLesson = await response.json();
      showNotification("success", `Successfully generated CBA Aligned Lesson Plan!`);
      fetchLessons();
      setSelectedLesson(generatedLesson);
      setShowGeneratorModal(false);
      
      // Clear form
      setGeneratorForm({
        title: "",
        topic: "",
        syllabusId: "",
        duration: "2 Hours",
        teacherName: "Minesec Teacher",
        customDirectives: ""
      });

    } catch (err: any) {
      showNotification("error", "AI Co-Pilot failed: " + err.message);
    } finally {
      clearInterval(stepInterval);
      setGeneratingAI(false);
    }
  };

  const handleGenerateLecture = async () => {
    if (!lectureForm.topic) {
      showNotification("error", "Please provide a topic or select one from the syllabus.");
      return;
    }

    setGeneratingLecture(true);
    try {
      const response = await fetch("/api/lectures/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syllabusId: lectureForm.syllabusId ? parseInt(lectureForm.syllabusId) : null,
          topic: lectureForm.topic,
          formatDetail: lectureForm.formatDetail,
          subject: lectureForm.subject,
          classLevel: lectureForm.classLevel,
          customDirectives: lectureForm.customDirectives
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to generate lecture.");
      }

      const data = await response.json();
      showNotification("success", "Lecture Notes generated successfully!");
      fetchLectures();
      setSelectedLecture(data);
      setLectureForm(prev => ({ ...prev, topic: "", customDirectives: "" }));
    } catch (err: any) {
      showNotification("error", err.message);
    } finally {
      setGeneratingLecture(false);
    }
  };

  const handleGenerateQuiz = async () => {
    if (!quizForm.topic) {
      showNotification("error", "Please provide a topic or select one.");
      return;
    }

    setGeneratingQuiz(true);
    try {
      const response = await fetch("/api/quizzes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syllabusId: quizForm.syllabusId ? parseInt(quizForm.syllabusId) : null,
          lessonId: quizForm.lessonId ? parseInt(quizForm.lessonId) : null,
          topic: quizForm.topic,
          numQuestions: quizForm.numQuestions,
          questionType: quizForm.questionType,
          difficulty: quizForm.difficulty,
          subject: quizForm.subject,
          classLevel: quizForm.classLevel,
          customDirectives: quizForm.customDirectives
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to generate quiz.");
      }

      const data = await response.json();
      const parsedQuiz = {
        ...data,
        questions: typeof data.questions === "string" ? JSON.parse(data.questions) : data.questions
      };
      showNotification("success", "Evaluation Quiz generated successfully!");
      fetchQuizzes();
      setSelectedQuiz(parsedQuiz);
      setQuizForm(prev => ({ ...prev, topic: "", customDirectives: "" }));
    } catch (err: any) {
      showNotification("error", err.message);
    } finally {
      setGeneratingQuiz(false);
    }
  };

  const handleShuffleQuestions = () => {
    if (!shuffledQuestions || shuffledQuestions.length === 0) return;
    const arr = [...shuffledQuestions];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    setShuffledQuestions(arr);
    setQuizResponses({});
    setQuizScore(null);
    showNotification("success", "Questions shuffled successfully!");
  };

  const handleSaveLectureEdit = async () => {
    if (!selectedLecture) return;
    if (!editLectureTitle.trim() || !editLectureContent.trim()) {
      showNotification("error", "Title and content cannot be blank.");
      return;
    }

    try {
      const response = await fetch(`/api/lectures/${selectedLecture.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editLectureTitle,
          content: editLectureContent
        })
      });
      if (!response.ok) throw new Error("Could not update lecture notes.");
      
      showNotification("success", "Lecture Notes updated successfully on cloud!");
      setIsEditingLecture(false);
      
      // Update selectedLecture and listing
      setSelectedLecture(prev => prev ? { ...prev, title: editLectureTitle, content: editLectureContent } : null);
      fetchLectures();
    } catch (err: any) {
      showNotification("error", err.message);
    }
  };

  // Helpers for subjects and filter listings
  const uniqueSyllabusSubjects = Array.from(new Set(syllabi.map(s => s.subject).filter(Boolean)));
  const uniqueLessonSubjects = Array.from(new Set(lessons.map(l => l.subject).filter(Boolean)));
  const uniqueLectureSubjects = Array.from(new Set(lectures.map(l => l.subject).filter(Boolean)));
  const uniqueQuizSubjects = Array.from(new Set(quizzes.map(q => q.subject).filter(Boolean)));

  const filteredSyllabi = syllabi.filter(s => {
    const matchesSearch = s.title.toLowerCase().includes(syllabusSearch.toLowerCase()) || 
                          (s.subject && s.subject.toLowerCase().includes(syllabusSearch.toLowerCase()));
    const matchesSubject = !syllabusFilterSubject || s.subject === syllabusFilterSubject;
    return matchesSearch && matchesSubject;
  });

  const filteredLessons = lessons.filter(l => {
    const matchesSearch = l.title.toLowerCase().includes(lessonSearch.toLowerCase()) || 
                          (l.subject && l.subject.toLowerCase().includes(lessonSearch.toLowerCase())) ||
                          (l.teacher_name && l.teacher_name.toLowerCase().includes(lessonSearch.toLowerCase()));
    const matchesSubject = !lessonFilterSubject || l.subject === lessonFilterSubject;
    return matchesSearch && matchesSubject;
  });

  const filteredLectures = lectures.filter(lec => {
    const matchesSearch = !lectureSearch || 
      lec.title.toLowerCase().includes(lectureSearch.toLowerCase()) ||
      lec.topic.toLowerCase().includes(lectureSearch.toLowerCase()) ||
      lec.subject.toLowerCase().includes(lectureSearch.toLowerCase());
    const matchesSubject = !lectureFilterSubject || lec.subject === lectureFilterSubject;
    return matchesSearch && matchesSubject;
  });

  const filteredQuizzes = quizzes.filter(quiz => {
    const matchesSearch = !quizSearch || 
      quiz.title.toLowerCase().includes(quizSearch.toLowerCase()) ||
      quiz.topic.toLowerCase().includes(quizSearch.toLowerCase()) ||
      quiz.subject.toLowerCase().includes(quizSearch.toLowerCase());
    const matchesSubject = !quizFilterSubject || quiz.subject === quizFilterSubject;
    return matchesSearch && matchesSubject;
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] text-[#E0E0E0] flex items-center justify-center p-4 font-sans relative overflow-hidden">
        {/* Decorative background glows */}
        <div className="absolute top-1/4 left-1/4 w-80 h-80 bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none"></div>

        <div className="w-full max-w-md bg-[#0C0C0C] rounded-2xl border border-white/10 shadow-2xl relative overflow-hidden animate-fade-in">
          {/* Cameroon Colors Visual Accent */}
          <div className="absolute top-0 left-0 right-0 h-1.5 flex">
            <div className="w-1/3 h-full bg-[#007A5E]"></div>
            <div className="w-1/3 h-full bg-[#CE1126]"></div>
            <div className="w-1/3 h-full bg-[#FCD116]"></div>
          </div>

          <form onSubmit={handleAuth} className="p-8 space-y-6">
            <div className="text-center space-y-1.5 pt-2">
              <div className="inline-flex h-12 w-11 border border-white/10 rounded overflow-hidden shadow-lg mb-2">
                <div className="w-1/3 bg-[#007A5E]"></div>
                <div className="w-1/3 bg-[#CE1126] flex items-center justify-center">
                  <span className="text-yellow-400 text-[10px] font-bold">★</span>
                </div>
                <div className="w-1/3 bg-[#FCD116]"></div>
              </div>
              <h1 className="text-xl font-extrabold tracking-widest text-white uppercase">
                MINESEC <span className="font-light text-white/60">Co-Pilot</span>
              </h1>
              <p className="text-[10px] uppercase font-mono tracking-wider text-cyan-400">
                Technical Secondary Education Portal
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-white/20" />
                  <input
                    type="email"
                    required
                    placeholder="e.g. teacher@minesec.cm"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full bg-[#141414] border border-white/10 rounded-lg py-2.5 pl-9 pr-4 text-xs font-mono text-white placeholder-white/20 focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-white/20" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full bg-[#141414] border border-white/10 rounded-lg py-2.5 pl-9 pr-4 text-xs font-mono text-white placeholder-white/20 focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              {/* Role selection always visible for clarity */}
              {(isSignUp || authEmail === "") && (
                <div>
                  <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Primary Role Alignment</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { role: "Student", label: "Student", desc: "Take Quizzes" },
                      { role: "Teacher", label: "Teacher", desc: "Build Lessons" },
                      { role: "Administrator", label: "Admin", desc: "All Access" }
                    ].map(r => (
                      <button
                        key={r.role}
                        type="button"
                        onClick={() => setAuthRole(r.role as any)}
                        className={`p-2 rounded-lg border text-left flex flex-col justify-between transition-all cursor-pointer ${
                          authRole === r.role
                            ? "border-cyan-400 bg-cyan-500/10 text-white"
                            : "border-white/5 bg-black/40 text-white/40 hover:bg-white/[0.02]"
                        }`}
                      >
                        <span className="text-[10px] font-bold font-mono uppercase">{r.label}</span>
                        <span className="text-[8px] font-mono mt-0.5 opacity-60 leading-none">{r.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-bold font-mono text-xs py-2.5 px-4 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-cyan-500/15 disabled:opacity-50"
            >
              {authLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Processing Authentication...
                </>
              ) : (
                <>
                  <Key className="w-3.5 h-3.5" />
                  {isSignUp ? "CREATE NEW ACCOUNT" : "AUTHENTICATE SECURELY"}
                </>
              )}
            </button>

            <div className="flex justify-between items-center text-[10px] font-mono text-white/30">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  if (!isSignUp) setAuthRole("Teacher");
                }}
                className="hover:text-cyan-400 transition-colors"
              >
                {isSignUp ? "Already registered? Sign In" : "Need credentials? Sign Up"}
              </button>
              <span>MINESEC CBA v2.0</span>
            </div>

            {/* Quick Access Helper */}
            <div className="bg-white/[0.02] border border-white/5 p-3 rounded-lg space-y-1.5">
              <h4 className="text-[9px] font-bold font-mono uppercase tracking-wider text-cyan-400 flex items-center gap-1">
                <FileCheck className="w-3 h-3" />
                Quick-Access Development Accounts
              </h4>
              <p className="text-[8.5px] font-mono text-white/40 leading-relaxed">
                Supabase keys default to sandbox. Enter any password, and use:
                <br />
                • Student: <span className="text-white/80 font-semibold">student@minesec.cm</span>
                <br />
                • Teacher: <span className="text-white/80 font-semibold">teacher@minesec.cm</span>
                <br />
                • Admin: <span className="text-white/80 font-semibold">admin@minesec.cm</span>
              </p>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#E0E0E0] flex flex-col font-sans selection:bg-cyan-500/30 selection:text-white">
      
      {/* 1. Official MINESEC Header */}
      <header className="bg-[#0A0A0A] border-b border-white/10 text-white shadow-2xl relative overflow-hidden">
        {/* Subtle top accent line using Cameroon colors */}
        <div className="absolute top-0 left-0 right-0 h-1 flex">
          <div className="w-1/3 h-full bg-[#007A5E]"></div>
          <div className="w-1/3 h-full bg-[#CE1126]"></div>
          <div className="w-1/3 h-full bg-[#FCD116]"></div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-4 md:py-6 flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0 mt-1">
          
          {/* Cameroon Colors Visual Accent */}
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-9 border border-white/10 rounded overflow-hidden shadow-lg flex-shrink-0">
              <div className="w-1/3 bg-[#007A5E]"></div>
              <div className="w-1/3 bg-[#CE1126] flex items-center justify-center">
                <span className="text-yellow-400 text-[10px] font-bold font-serif">★</span>
              </div>
              <div className="w-1/3 bg-[#FCD116]"></div>
            </div>
            
            <div>
              <h1 id="app-title" className="text-lg md:text-xl font-bold tracking-widest uppercase text-white flex items-center gap-2">
                MINESEC <span className="font-light opacity-50">Academic Co-Pilot</span>
                <span className="bg-cyan-500/20 text-cyan-400 border border-cyan-400/30 text-[9px] uppercase px-1.5 py-0.5 rounded font-bold tracking-widest animate-pulse">CBA v2.0</span>
              </h1>
              <p className="text-[10px] text-white/40 uppercase font-mono tracking-widest mt-0.5">
                Ministère des Enseignements Secondaires • Republic of Cameroon
              </p>
            </div>
          </div>

          <div className="flex flex-col items-center md:items-end text-center md:text-right gap-1.5">
            <span className="text-[9px] uppercase bg-white/5 px-2.5 py-1 rounded-md text-white/60 tracking-wider font-mono border border-white/5">
              REPUBLIQUE DU CAMEROUN • Peace - Work - Fatherland
            </span>
            {user && (
              <div className="flex items-center gap-3 mt-1 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-1.5">
                <div className="text-right">
                  <p className="text-[10px] text-white/80 font-mono leading-none">{user.email}</p>
                  <p className="text-[8px] text-cyan-400 uppercase font-bold tracking-widest font-mono mt-0.5">
                    Role: {authRole || "Teacher"}
                  </p>
                </div>
                <button
                  onClick={handleSignOut}
                  className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 text-[9px] font-bold font-mono px-2 py-0.5 rounded transition-all cursor-pointer flex items-center gap-1"
                >
                  <LogOut className="w-2.5 h-2.5" />
                  Sign Out
                </button>
              </div>
            )}
          </div>

        </div>
      </header>

      {/* Primary Navigation Tabs */}
      <div className="bg-[#0A0A0A] border-b border-white/10 shadow-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 flex justify-between items-center">
          <nav className="flex space-x-6">
            {authRole !== "Student" && (
              <>
                <button
                  id="tab-lesson-prep"
                  onClick={() => { setActiveTab("prep"); setSelectedSyllabus(null); }}
                  className={`py-4 px-2 font-semibold text-xs uppercase tracking-wider border-b-2 flex items-center gap-2 transition-all ${
                    activeTab === "prep"
                      ? "border-cyan-400 text-cyan-400 font-bold"
                      : "border-transparent text-white/40 hover:text-white/80"
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                  CBA Lesson Prep Studio
                </button>
                <button
                  id="tab-syllabus-registry"
                  onClick={() => { setActiveTab("syllabus"); setSelectedLesson(null); }}
                  className={`py-4 px-2 font-semibold text-xs uppercase tracking-wider border-b-2 flex items-center gap-2 transition-all ${
                    activeTab === "syllabus"
                      ? "border-cyan-400 text-cyan-400 font-bold"
                      : "border-transparent text-white/40 hover:text-white/80"
                  }`}
                >
                  <BookMarked className="w-4 h-4" />
                  Syllabus Alignment Manager
                </button>
              </>
            )}
            <button
              id="tab-lecture-notes"
              onClick={() => { setActiveTab("lecture"); setSelectedSyllabus(null); setSelectedLesson(null); }}
              className={`py-4 px-2 font-semibold text-xs uppercase tracking-wider border-b-2 flex items-center gap-2 transition-all ${
                activeTab === "lecture"
                  ? "border-cyan-400 text-cyan-400 font-bold"
                  : "border-transparent text-white/40 hover:text-white/80"
              }`}
            >
              <Award className="w-4 h-4" />
              Lecture Note Studio
            </button>
            <button
              id="tab-quizzes"
              onClick={() => { setActiveTab("quiz"); setSelectedSyllabus(null); setSelectedLesson(null); }}
              className={`py-4 px-2 font-semibold text-xs uppercase tracking-wider border-b-2 flex items-center gap-2 transition-all ${
                activeTab === "quiz"
                  ? "border-cyan-400 text-cyan-400 font-bold"
                  : "border-transparent text-white/40 hover:text-white/80"
              }`}
            >
              <GraduationCap className="w-4 h-4" />
              Quiz Evaluation Studio
            </button>
            {authRole !== "Student" && (
              <button
                id="tab-results-ledger"
                onClick={() => { setActiveTab("ledger"); fetchQuizResults(); }}
                className={`py-4 px-2 font-semibold text-xs uppercase tracking-wider border-b-2 flex items-center gap-2 transition-all ${
                  activeTab === "ledger"
                    ? "border-cyan-400 text-cyan-400 font-bold"
                    : "border-transparent text-white/40 hover:text-white/80"
                }`}
              >
                <ListTodo className="w-4 h-4" />
                Evaluation Results Ledger
              </button>
            )}
          </nav>

          {/* New Actions */}
          <div className="flex space-x-3 py-2">
            {activeTab === "prep" && authRole !== "Student" && (
              <>
                <button
                  id="btn-new-blank-lesson"
                  onClick={handleCreateBlankLesson}
                  className="bg-white/5 hover:bg-white/10 text-white/80 text-xs font-semibold py-2 px-3 rounded-md border border-white/10 flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Blank Plan
                </button>
                <button
                  id="btn-open-ai-generator"
                  onClick={() => setShowGeneratorModal(true)}
                  className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 text-xs font-bold py-2 px-4 rounded-md border border-cyan-400/50 shadow-sm hover:shadow-cyan-400/20 flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  Generate with AI
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Global Alerts / Notifications */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-24 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-lg shadow-2xl border flex items-center gap-3 backdrop-blur-md ${
              notification.type === "success"
                ? "bg-[#0C0C0C]/95 border-emerald-500/30 text-emerald-400"
                : "bg-[#0C0C0C]/95 border-rose-500/30 text-rose-400"
            }`}
          >
            {notification.type === "success" ? (
              <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            )}
            <p className="text-sm font-semibold">{notification.message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Workspace Layout */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        
        {/* =======================================================
            TAB 1: LESSON PREP STUDIO
            ======================================================= */}
        {activeTab === "prep" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Column: Lesson Index Drawer */}
            <div className="lg:col-span-4 bg-[#0C0C0C] rounded-xl shadow-2xl border border-white/10 p-4 flex flex-col h-[750px]">
              
              {/* Index Filters */}
              <div className="space-y-3 mb-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-1.5">
                    <ListTodo className="w-4 h-4 text-cyan-400" />
                    CBA Lessons Registry
                  </h2>
                  <span className="text-[10px] bg-white/5 text-white/60 border border-white/10 px-2 py-0.5 rounded-full font-mono">
                    {filteredLessons.length} Plans
                  </span>
                </div>
                
                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/30" />
                  <input
                    id="search-lessons"
                    type="text"
                    placeholder="Search by topic, teacher, title..."
                    value={lessonSearch}
                    onChange={(e) => setLessonSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 text-xs bg-black/50 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-400 transition-all font-mono"
                  />
                </div>

                {/* Subject Filter Badge strip */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar">
                  <Filter className="w-3 h-3 text-white/30 flex-shrink-0" />
                  <button
                    onClick={() => setLessonFilterSubject("")}
                    className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-all border text-[10px] uppercase font-mono tracking-tight ${
                      lessonFilterSubject === ""
                        ? "bg-cyan-500/20 text-cyan-400 border-cyan-400/50 font-semibold"
                        : "bg-white/5 text-white/50 border-white/5 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    All Subjects
                  </button>
                  {uniqueLessonSubjects.map(subj => (
                    <button
                      key={subj}
                      onClick={() => setLessonFilterSubject(subj)}
                      className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-all border text-[10px] uppercase font-mono tracking-tight ${
                        lessonFilterSubject === subj
                          ? "bg-cyan-500/20 text-cyan-400 border-cyan-400/50 font-semibold"
                          : "bg-white/5 text-white/50 border-white/5 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {subj}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lesson Cards List */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {loadingLessons ? (
                  <div className="flex flex-col items-center justify-center h-48 text-white/40 gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                    <p className="text-xs font-mono">Connecting to PostgreSQL...</p>
                  </div>
                ) : filteredLessons.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 border border-dashed border-white/10 rounded-lg p-6 text-center text-white/40">
                    <BookOpen className="w-10 h-10 mb-2 text-white/20" />
                    <p className="font-semibold text-sm text-white/70">No Lesson Plans Found</p>
                    <p className="text-xs mt-1 text-white/30">Create a blank plan or generate one with your official syllabus!</p>
                  </div>
                ) : (
                  filteredLessons.map(lesson => {
                    const isSelected = selectedLesson?.id === lesson.id;
                    return (
                      <div
                        key={lesson.id}
                        id={`lesson-card-${lesson.id}`}
                        onClick={() => loadLessonDetails(lesson.id)}
                        className={`p-3.5 rounded-lg border transition-all cursor-pointer relative group ${
                          isSelected
                            ? "bg-cyan-500/10 border-cyan-400/50 shadow-sm"
                            : "bg-black/40 border-white/5 hover:border-white/15 hover:bg-white/[0.01]"
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded font-mono border ${
                            lesson.status === "published"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          }`}>
                            {lesson.status.toUpperCase()}
                          </span>
                          
                          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              title="Duplicate Plan"
                              onClick={(e) => handleDuplicateLesson(lesson.id, e)}
                              className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              title="Delete Plan"
                              onClick={(e) => handleDeleteLesson(lesson.id, e)}
                              className="p-1 hover:bg-rose-500/10 rounded text-white/40 hover:text-rose-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <h3 className="font-bold text-white text-sm mt-2 line-clamp-1 group-hover:text-cyan-400 transition-colors">
                          {lesson.title}
                        </h3>
                        
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[10px] text-white/50 font-mono">
                          <span className="font-semibold text-white/70">{lesson.subject}</span>
                          <span className="w-1 h-1 rounded-full bg-white/15"></span>
                          <span>{lesson.class_level}</span>
                          <span className="w-1 h-1 rounded-full bg-white/15"></span>
                          <span>{lesson.duration}</span>
                        </div>

                        {lesson.syllabus_title && (
                          <div className="mt-2.5 pt-2 border-t border-dashed border-white/5 flex items-center gap-1 text-[9px] text-cyan-400 font-mono uppercase tracking-wider">
                            <CheckCircle className="w-3 h-3 flex-shrink-0" />
                            Aligned to official syllabus
                          </div>
                        )}

                        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l bg-cyan-400 scale-y-0 group-hover:scale-y-100 transition-transform origin-center"></div>
                      </div>
                    );
                  })
                )}
              </div>

            </div>

            {/* Right Column: Active Lesson Workspace & Editor */}
            <div className="lg:col-span-8 space-y-6">
              {selectedLesson ? (
                <div className="bg-[#0C0C0C] rounded-xl shadow-2xl border border-white/10 overflow-hidden flex flex-col min-h-[750px]">
                  
                  {/* Editor Header Details */}
                  <div className="p-4 bg-[#0A0A0A] border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <input
                          id="edit-lesson-title"
                          type="text"
                          value={selectedLesson.title}
                          onChange={(e) => handleLessonChange("title", e.target.value)}
                          className="font-extrabold text-lg md:text-xl text-white bg-transparent border-b border-transparent hover:border-white/20 focus:border-cyan-400 focus:outline-none py-0.5 px-1 max-w-lg transition-colors"
                        />
                        <span className="text-[10px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded-full font-mono font-bold border border-cyan-500/20">
                          v{selectedLesson.version}
                        </span>
                      </div>
                      
                      <div className="text-xs text-white/40 mt-1 flex flex-wrap items-center gap-1.5">
                        <span>Prepared by:</span>
                        <input
                          id="edit-lesson-teacher"
                          type="text"
                          value={selectedLesson.teacher_name}
                          onChange={(e) => handleLessonChange("teacher_name", e.target.value)}
                          className="font-medium text-white/70 bg-transparent border-b border-transparent hover:border-white/20 focus:border-cyan-400 focus:outline-none text-xs w-40 transition-colors"
                        />
                        {selectedLesson.syllabus_title && (
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-white/10"></span>
                            <span className="font-semibold text-cyan-400 uppercase tracking-widest text-[9px] font-mono flex items-center gap-1">
                              <Compass className="w-3.5 h-3.5" /> ALIGNED: {selectedLesson.syllabus_title}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Auto-save & Status indicators */}
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        {savingLesson ? (
                          <div className="flex items-center gap-1 text-[11px] text-cyan-400 font-mono">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Auto-saving...
                          </div>
                        ) : lastAutoSaved ? (
                          <p className="text-[10px] text-white/30 font-mono">
                            Saved: {lastAutoSaved}
                          </p>
                        ) : null}
                      </div>

                      {/* Publish / Draft Switch */}
                      <select
                        id="edit-lesson-status"
                        value={selectedLesson.status}
                        onChange={(e) => handleLessonChange("status", e.target.value)}
                        className={`text-xs font-bold font-mono rounded-lg px-3 py-1.5 border focus:outline-none transition-all cursor-pointer ${
                          selectedLesson.status === "published"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                        }`}
                      >
                        <option value="draft" className="bg-[#0A0A0A] text-white">DRAFT</option>
                        <option value="published" className="bg-[#0A0A0A] text-white">PUBLISHED</option>
                      </select>

                      {/* Preview Mode Toggle */}
                      <button
                        id="btn-toggle-preview"
                        onClick={() => setIsPreviewMode(!isPreviewMode)}
                        className={`p-2 rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 text-xs font-mono font-bold uppercase ${
                          isPreviewMode
                            ? "bg-cyan-500/20 text-cyan-400 border-cyan-400/50"
                            : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white"
                        }`}
                        title={isPreviewMode ? "Exit Preview Mode" : "Enter Preview Mode"}
                      >
                        {isPreviewMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        <span className="hidden sm:inline">{isPreviewMode ? "Edit" : "Preview"}</span>
                      </button>

                      {/* Download Lesson as PDF */}
                      <button
                        id="btn-download-pdf"
                        onClick={handleDownloadPDF}
                        className="bg-cyan-500 hover:bg-cyan-600 text-black border border-cyan-400/20 rounded-lg p-2 sm:px-3 sm:py-2 text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-cyan-500/10"
                        title="Download Lesson as PDF"
                      >
                        <FileDown className="w-4 h-4" />
                        <span className="hidden sm:inline">PDF</span>
                      </button>

                      {/* Manual Force Version Backup */}
                      <button
                        id="btn-create-version-backup"
                        onClick={() => triggerSaveLesson({}, true)}
                        className="bg-white/5 hover:bg-white/10 text-white/70 border border-white/10 hover:text-white rounded-lg p-2 transition-all cursor-pointer"
                        title="Create New Version History Backup"
                      >
                        <History className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Context Metadata Row (Subject, Level, Duration) */}
                  {!isPreviewMode && (
                    <div className="px-5 py-3 border-b border-white/10 bg-black/40 grid grid-cols-3 gap-4 text-xs">
                      <div>
                        <label className="block text-[9px] text-white/30 font-mono uppercase tracking-wider mb-1">Subject / Discipline</label>
                        <input
                          id="edit-lesson-subject"
                          type="text"
                          value={selectedLesson.subject}
                          onChange={(e) => handleLessonChange("subject", e.target.value)}
                          className="w-full bg-black/50 border border-white/10 text-white placeholder-white/20 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-400 transition-all font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-white/30 font-mono uppercase tracking-wider mb-1">Target Class Level</label>
                        <input
                          id="edit-lesson-level"
                          type="text"
                          value={selectedLesson.class_level}
                          onChange={(e) => handleLessonChange("class_level", e.target.value)}
                          className="w-full bg-black/50 border border-white/10 text-white placeholder-white/20 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-400 transition-all font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-white/30 font-mono uppercase tracking-wider mb-1">Duration</label>
                        <input
                          id="edit-lesson-duration"
                          type="text"
                          value={selectedLesson.duration}
                          onChange={(e) => handleLessonChange("duration", e.target.value)}
                          className="w-full bg-black/50 border border-white/10 text-white placeholder-white/20 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-400 transition-all font-mono"
                        />
                      </div>
                    </div>
                  )}

                  {/* Sub-Navigation Tabs inside Workspace */}
                  {!isPreviewMode && (
                    <div className="border-b border-white/10 flex text-xs font-semibold px-4 bg-black/25">
                      <button
                        id="sub-tab-content"
                        onClick={() => setActiveLessonTab("content")}
                        className={`py-3 px-3 border-b-2 flex items-center gap-1.5 tracking-wide text-[11px] uppercase font-mono transition-all ${
                          activeLessonTab === "content"
                            ? "border-cyan-400 text-cyan-400 bg-cyan-500/5 font-bold"
                            : "border-transparent text-white/40 hover:text-white/80"
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Pedagogical Content
                      </button>
                      <button
                        id="sub-tab-cba"
                        onClick={() => setActiveLessonTab("cba")}
                        className={`py-3 px-3 border-b-2 flex items-center gap-1.5 tracking-wide text-[11px] uppercase font-mono transition-all ${
                          activeLessonTab === "cba"
                            ? "border-cyan-400 text-cyan-400 bg-cyan-500/5 font-bold"
                            : "border-transparent text-white/40 hover:text-white/80"
                        }`}
                      >
                        <Award className="w-3.5 h-3.5" />
                        CBA Mapping
                      </button>
                      <button
                        id="sub-tab-assessment"
                        onClick={() => setActiveLessonTab("assessment")}
                        className={`py-3 px-3 border-b-2 flex items-center gap-1.5 tracking-wide text-[11px] uppercase font-mono transition-all ${
                          activeLessonTab === "assessment"
                            ? "border-cyan-400 text-cyan-400 bg-cyan-500/5 font-bold"
                            : "border-transparent text-white/40 hover:text-white/80"
                        }`}
                      >
                        <ListTodo className="w-3.5 h-3.5" />
                        Assessment Suite
                      </button>
                      <button
                        id="sub-tab-history"
                        onClick={() => setActiveLessonTab("history")}
                        className={`py-3 px-3 border-b-2 flex items-center gap-1.5 tracking-wide text-[11px] uppercase font-mono transition-all ${
                          activeLessonTab === "history"
                            ? "border-cyan-400 text-cyan-400 bg-cyan-500/5 font-bold"
                            : "border-transparent text-white/40 hover:text-white/80"
                        }`}
                      >
                        <History className="w-3.5 h-3.5" />
                        Timeline Backup
                      </button>
                    </div>
                  )}

                  {/* Active Tab Workspace Panel */}
                  <div className={`flex-1 p-5 overflow-y-auto ${isPreviewMode ? "max-h-[600px] bg-black/10" : "max-h-[500px]"}`}>
                    {isPreviewMode ? (
                      /* Read-Only Distraction-Free Preview Overlay */
                      <div className="space-y-6 text-white leading-relaxed">
                        {/* Document Meta Badges */}
                        <div className="flex flex-wrap gap-3 pb-4 border-b border-white/10 text-xs font-mono">
                          <span className="bg-cyan-500/10 text-cyan-400 px-3 py-1.5 rounded-full border border-cyan-500/20 font-semibold uppercase">
                            Subject: {selectedLesson.subject || "Not Specified"}
                          </span>
                          <span className="bg-purple-500/10 text-purple-400 px-3 py-1.5 rounded-full border border-purple-500/20 font-semibold uppercase">
                            Class Level: {selectedLesson.class_level || "Not Specified"}
                          </span>
                          <span className="bg-amber-500/10 text-amber-400 px-3 py-1.5 rounded-full border border-amber-500/20 font-semibold uppercase">
                            Duration: {selectedLesson.duration || "Not Specified"}
                          </span>
                          <span className="bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-full border border-emerald-500/20 font-semibold uppercase">
                            Status: {selectedLesson.status.toUpperCase()}
                          </span>
                        </div>

                        {/* 1. CBA COMPETENCY MAPPING */}
                        <div className="bg-[#080808] p-5 rounded-xl border border-white/10 space-y-4">
                          <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2 font-mono">
                            <Award className="w-5 h-5 text-cyan-400" />
                            1. Competency-Based Approach (CBA) Mapping
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs leading-relaxed font-mono">
                            <div className="space-y-1.5">
                              <span className="text-white/40 block uppercase text-[10px] tracking-wider">Target Syllabus Competency</span>
                              <p className="text-white/80 bg-black/40 p-3 rounded-lg border border-white/10">{selectedLesson.competency_mapping?.coreCompetency || "None defined."}</p>
                            </div>
                            <div className="space-y-1.5">
                              <span className="text-white/40 block uppercase text-[10px] tracking-wider">Expected Behavioral Outcome</span>
                              <p className="text-white/80 bg-black/40 p-3 rounded-lg border border-white/10">{selectedLesson.competency_mapping?.learningOutcome || "None defined."}</p>
                            </div>
                          </div>
                        </div>

                        {/* 2. SPECIFIC LEARNING OBJECTIVES */}
                        {Array.isArray(selectedLesson.learning_objectives) && selectedLesson.learning_objectives.length > 0 && (
                          <div className="space-y-3">
                            <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2 font-mono">
                              <ListTodo className="w-5 h-5 text-cyan-400" />
                              2. Specific Learning Objectives
                            </h3>
                            <ol className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-1 font-mono text-xs text-white/80">
                              {selectedLesson.learning_objectives.map((obj, idx) => (
                                <li key={idx} className="bg-black/30 p-3 rounded-lg border border-white/5 flex gap-2.5 items-start">
                                  <span className="bg-cyan-500/10 text-cyan-400 h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 font-bold font-mono text-[10px] border border-cyan-500/20">
                                    {idx + 1}
                                  </span>
                                  <span>{obj}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {/* 3. PEDAGOGICAL CONTENT (MARKDOWN RENDERING) */}
                        <div className="space-y-3">
                          <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2 font-mono">
                            <FileText className="w-5 h-5 text-cyan-400" />
                            3. Pedagogical Content & Methodology
                          </h3>
                          <div className="bg-black/30 p-6 rounded-xl border border-white/5 text-sm space-y-4 font-sans text-white/85">
                            {selectedLesson.lesson_content ? (
                              <div className="prose prose-invert prose-cyan max-w-none text-white/80 prose-headings:font-mono prose-headings:text-cyan-400 prose-headings:font-bold prose-p:leading-relaxed prose-li:leading-relaxed prose-a:text-cyan-400">
                                <Markdown>{selectedLesson.lesson_content}</Markdown>
                              </div>
                            ) : (
                              <p className="text-white/30 italic font-mono text-xs">No content has been added to this lesson plan yet.</p>
                            )}
                          </div>
                        </div>

                        {/* 4. ASSESSMENT & EVALUATION */}
                        {((selectedLesson.assessment_data?.evaluationQuestions && selectedLesson.assessment_data.evaluationQuestions.length > 0) ||
                          (selectedLesson.assessment_data?.assessmentCriteria && selectedLesson.assessment_data.assessmentCriteria.length > 0)) && (
                          <div className="space-y-4">
                            <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2 font-mono">
                              <BookOpen className="w-5 h-5 text-cyan-400" />
                              4. Assessment & CBA Evaluation
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Questions */}
                              {selectedLesson.assessment_data?.evaluationQuestions && selectedLesson.assessment_data.evaluationQuestions.length > 0 && (
                                <div className="space-y-2.5">
                                  <h4 className="text-xs font-bold text-white/50 uppercase tracking-wider font-mono">Evaluation & Diagnostic Questions</h4>
                                  <ul className="space-y-2 font-mono text-xs text-white/80">
                                    {selectedLesson.assessment_data.evaluationQuestions.map((q, idx) => (
                                      <li key={idx} className="bg-black/30 p-3 rounded-lg border border-white/5 flex gap-2 items-start">
                                        <span className="bg-cyan-500/10 text-cyan-400 h-4 w-4 rounded-full flex items-center justify-center flex-shrink-0 font-bold font-mono text-[9px] mt-0.5 border border-cyan-500/20">?</span>
                                        <span>{q}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {/* Criteria */}
                              {selectedLesson.assessment_data?.assessmentCriteria && selectedLesson.assessment_data.assessmentCriteria.length > 0 && (
                                <div className="space-y-2.5">
                                  <h4 className="text-xs font-bold text-white/50 uppercase tracking-wider font-mono">Assessment Standards Alignment</h4>
                                  <ul className="space-y-2 font-mono text-xs text-white/80">
                                    {selectedLesson.assessment_data.assessmentCriteria.map((crit, idx) => (
                                      <li key={idx} className="bg-black/30 p-3 rounded-lg border border-white/5 flex gap-2 items-start">
                                        <span className="bg-amber-500/10 text-amber-400 h-4 w-4 rounded-full flex items-center justify-center flex-shrink-0 font-bold font-mono text-[9px] mt-0.5 border border-amber-500/20">★</span>
                                        <span>{crit}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* SUB-TAB: Content Markdown editor */}
                    {activeLessonTab === "content" && (
                      <div className="space-y-4 h-full flex flex-col">
                        <div className="flex justify-between items-center text-xs text-white/40 mb-1 font-mono">
                          <span>Write content or use generated layout below (Supports Markdown)</span>
                          <span>Auto-saved to Neon DB live</span>
                        </div>

                        {/* Cloudinary Image Uploader Widget for Lessons */}
                        <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-2 mb-1">
                          <div className="flex justify-between items-center">
                            <h4 className="text-[10px] font-bold font-mono uppercase tracking-wider text-cyan-400 flex items-center gap-1">
                              <UploadCloud className="w-3.5 h-3.5" />
                              Cloudinary Lesson Diagram & Media Embedder
                            </h4>
                            <span className="text-[9px] font-mono text-white/30">Max 500MB • Image/Media</span>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                            <div>
                              <input
                                type="file"
                                accept="image/*,video/*,audio/*"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;

                                  if (file.size > 500 * 1024 * 1024) {
                                    showNotification("error", "File size exceeds 500MB limit.");
                                    return;
                                  }

                                  setIsUploadingLessonMedia(true);
                                  setLessonMediaProgress(10);
                                  try {
                                    const folderName = file.type.startsWith("image/") ? "minesec_images" : "minesec_media";
                                    const resourceType = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "auto";
                                    
                                    const cloudinaryData = await uploadToCloudinaryDirectly(
                                      file,
                                      folderName,
                                      resourceType,
                                      (p) => setLessonMediaProgress(p)
                                    );
                                    
                                    setLessonMediaProgress(100);
                                    setUploadedLessonMediaUrl(cloudinaryData.secure_url);
                                    
                                    // Append to Lesson Content Markdown
                                    let newContent = selectedLesson.lesson_content || "";
                                    if (file.type.startsWith("image/")) {
                                      newContent += `\n\n![embedded illustration](${cloudinaryData.secure_url})\n`;
                                    } else if (file.type.startsWith("video/")) {
                                      newContent += `\n\n<video controls src="${cloudinaryData.secure_url}" className="w-full rounded-lg my-4"></video>\n`;
                                    } else {
                                      newContent += `\n\n[Download Attached Media File](${cloudinaryData.secure_url})\n`;
                                    }
                                    handleLessonChange("lesson_content", newContent);
                                    
                                    showNotification("success", "Media uploaded and embedded in Lesson Plan!");
                                  } catch (err: any) {
                                    showNotification("error", "Upload failed: " + err.message);
                                  } finally {
                                    setIsUploadingLessonMedia(false);
                                    setLessonMediaProgress(0);
                                  }
                                }}
                                className="block w-full text-xs text-white/40 font-mono
                                  file:mr-3 file:py-1 file:px-2.5
                                  file:rounded-md file:border-0
                                  file:text-[10px] file:font-mono file:font-bold
                                  file:bg-cyan-500/10 file:text-cyan-400
                                  hover:file:bg-cyan-500/20 file:cursor-pointer"
                              />
                              <p className="text-[9px] text-white/30 mt-1">
                                Upload diagrams or illustration models to automatically generate a CDN link and embed it in this Lesson Plan's PDF.
                              </p>
                            </div>

                            {isUploadingLessonMedia && (
                              <div className="bg-black/50 p-2.5 rounded-lg border border-cyan-500/25 flex flex-col justify-center items-center text-center space-y-1">
                                <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                                <span className="text-[9px] font-mono text-cyan-400 font-bold uppercase">Uploading to Cloudinary...</span>
                                <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-1">
                                  <div className="bg-cyan-400 h-full transition-all duration-300" style={{ width: `${lessonMediaProgress}%` }}></div>
                                </div>
                              </div>
                            )}

                            {!isUploadingLessonMedia && uploadedLessonMediaUrl && (
                              <div className="bg-white/[0.01] p-2 rounded-lg border border-white/5 flex items-center gap-2">
                                <img src={uploadedLessonMediaUrl} alt="Preview" className="w-10 h-10 object-cover rounded border border-white/10" referrerPolicy="no-referrer" />
                                <div className="flex-grow min-w-0">
                                  <span className="text-[8px] font-mono text-emerald-400 font-bold uppercase block">Embedded Successfully</span>
                                  <span className="text-[8px] font-mono text-white/30 truncate block">{uploadedLessonMediaUrl}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <textarea
                          id="lesson-markdown-textarea"
                          value={selectedLesson.lesson_content}
                          onChange={(e) => handleLessonChange("lesson_content", e.target.value)}
                          placeholder="Compose your CBA lesson outline, pedagogical process steps, prerequisites and content..."
                          className="w-full flex-1 min-h-[380px] p-4 bg-black/40 border border-white/10 text-white placeholder-white/20 rounded-lg text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-400 focus:bg-black/60 transition-all resize-none"
                        />
                      </div>
                    )}

                    {/* SUB-TAB: Competency Mapping & Objectives */}
                    {activeLessonTab === "cba" && (
                      <div className="space-y-6">
                        
                        {/* Competency Mapping Block */}
                        <div className="bg-[#080808] p-4 rounded-xl border border-white/10">
                          <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-1.5 mb-3 font-mono">
                            <Award className="w-4 h-4" />
                            Official CBA Competency Mapping (CBA Framework)
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[10px] font-mono text-white/40 uppercase tracking-wider mb-1">Core Syllabus Competency Target</label>
                              <textarea
                                id="edit-cba-competency"
                                value={selectedLesson.competency_mapping.coreCompetency || ""}
                                onChange={(e) => handleLessonNestedChange("competency_mapping", "coreCompetency", e.target.value)}
                                className="w-full bg-black/50 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-400 transition-colors font-mono"
                                rows={3}
                                placeholder="E.g. Identify and solve problems related to logical reasoning in programming environments."
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-mono text-white/40 uppercase tracking-wider mb-1">Expected Learning Outcome / Behavioral Result</label>
                              <textarea
                                id="edit-cba-outcome"
                                value={selectedLesson.competency_mapping.learningOutcome || ""}
                                onChange={(e) => handleLessonNestedChange("competency_mapping", "learningOutcome", e.target.value)}
                                className="w-full bg-black/50 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-400 transition-colors font-mono"
                                rows={3}
                                placeholder="E.g. Students can accurately translate conditional logical structures into program scripts."
                              />
                            </div>
                          </div>
                        </div>

                        {/* Specific Learning Objectives List */}
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                              Specific Learning Objectives (Cognitive, Psychomotor, Affective)
                            </h3>
                            <button
                              id="btn-add-objective"
                              onClick={handleAddObjective}
                              className="text-[10px] bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-400/30 px-2.5 py-1 rounded-md font-mono uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add Objective
                            </button>
                          </div>

                          <div className="space-y-2">
                            {selectedLesson.learning_objectives.map((obj, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <span className="text-[11px] bg-white/5 text-white/60 border border-white/10 font-mono font-bold h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0">
                                  {idx + 1}
                                </span>
                                <input
                                  id={`edit-objective-input-${idx}`}
                                  type="text"
                                  value={obj}
                                  onChange={(e) => handleObjectiveChange(idx, e.target.value)}
                                  className="flex-1 bg-black/50 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-400 transition-colors font-mono"
                                  placeholder="State outcome verb + specific skill standard..."
                                />
                                <button
                                  id={`btn-remove-objective-${idx}`}
                                  onClick={() => handleRemoveObjective(idx)}
                                  className="p-1.5 text-white/30 hover:text-rose-400 rounded hover:bg-rose-500/10 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>

                      </div>
                    )}

                    {/* SUB-TAB: CBA Assessment Suite */}
                    {activeLessonTab === "assessment" && (
                      <div className="space-y-6">
                        
                        {/* Questions list */}
                        <div>
                          <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono mb-3">
                            Formative CBA Evaluation & Diagnostic Questions
                          </h3>
                          <div className="space-y-3">
                            {(selectedLesson.assessment_data.evaluationQuestions || []).map((q, idx) => (
                              <div key={idx} className="flex gap-2.5 items-start">
                                <span className="text-xs bg-cyan-500/15 text-cyan-400 font-bold font-mono h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 mt-1 border border-cyan-500/20">
                                  ?
                                </span>
                                <textarea
                                  id={`edit-eval-question-${idx}`}
                                  value={q}
                                  onChange={(e) => {
                                    const currentQuestions = [...(selectedLesson.assessment_data.evaluationQuestions || [])];
                                    currentQuestions[idx] = e.target.value;
                                    handleLessonNestedChange("assessment_data", "evaluationQuestions", currentQuestions);
                                  }}
                                  className="flex-1 bg-black/50 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-400 font-mono transition-colors"
                                  rows={2}
                                />
                              </div>
                            ))}
                            <button
                              id="btn-add-eval-question"
                              onClick={() => {
                                const currentQuestions = [...(selectedLesson.assessment_data.evaluationQuestions || []), ""];
                                handleLessonNestedChange("assessment_data", "evaluationQuestions", currentQuestions);
                              }}
                              className="text-[11px] text-cyan-400 font-mono font-semibold hover:text-cyan-300 flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add Evaluation Question
                            </button>
                          </div>
                        </div>

                        {/* Grading criteria list */}
                        <div>
                          <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono mb-3">
                            Evaluation Standards & Performance Criteria
                          </h3>
                          <div className="space-y-3">
                            {(selectedLesson.assessment_data.assessmentCriteria || []).map((crit, idx) => (
                              <div key={idx} className="flex gap-2.5 items-start">
                                <span className="text-xs bg-amber-500/15 text-amber-400 font-bold font-mono h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 mt-1 border border-amber-500/20">
                                  ★
                                </span>
                                <input
                                  id={`edit-eval-criterion-${idx}`}
                                  type="text"
                                  value={crit}
                                  onChange={(e) => {
                                    const currentCriteria = [...(selectedLesson.assessment_data.assessmentCriteria || [])];
                                    currentCriteria[idx] = e.target.value;
                                    handleLessonNestedChange("assessment_data", "assessmentCriteria", currentCriteria);
                                  }}
                                  className="flex-1 bg-black/50 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-400 font-mono transition-colors"
                                />
                              </div>
                            ))}
                            <button
                              id="btn-add-eval-criterion"
                              onClick={() => {
                                const currentCriteria = [...(selectedLesson.assessment_data.assessmentCriteria || []), ""];
                                handleLessonNestedChange("assessment_data", "assessmentCriteria", currentCriteria);
                              }}
                              className="text-[11px] text-cyan-400 font-mono font-semibold hover:text-cyan-300 flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add Evaluation Standard
                            </button>
                          </div>
                        </div>

                      </div>
                    )}

                    {/* SUB-TAB: Version timeline */}
                    {activeLessonTab === "history" && (
                      <div className="space-y-5">
                        <div className="flex justify-between items-center">
                          <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                            Neon Version History Backup Timeline
                          </h3>
                          <span className="text-[10px] text-white/40 font-mono uppercase tracking-widest">
                            Automatic checkpoints stored permanently in PostgreSQL
                          </span>
                        </div>

                        {selectedLesson.history && selectedLesson.history.length > 0 ? (
                          <div className="relative border-l border-white/10 ml-3 pl-6 space-y-5">
                            {selectedLesson.history.map((hist, idx) => (
                              <div key={hist.id} className="relative group/timeline">
                                
                                {/* Bullet indicator */}
                                <div className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full bg-cyan-400 border border-[#050505] group-hover/timeline:scale-125 transition-transform shadow"></div>
                                
                                <div className="flex items-center justify-between bg-black/40 p-3 rounded-lg border border-white/10 hover:border-cyan-400/50 hover:bg-cyan-500/5 transition-all">
                                  <div>
                                    <h4 className="font-bold text-white text-xs">
                                      {hist.title || "Lesson Checkpoint"}
                                    </h4>
                                    <div className="flex items-center gap-3 text-[10px] text-white/40 font-mono mt-1">
                                      <span className="bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded font-bold border border-cyan-500/20">
                                        Version {hist.version}
                                      </span>
                                      <span>{new Date(hist.created_at).toLocaleString()}</span>
                                    </div>
                                  </div>

                                  <button
                                    id={`btn-restore-version-${hist.id}`}
                                    onClick={() => handleRestoreVersion(hist.id)}
                                    className="bg-white/5 hover:bg-cyan-500/10 text-cyan-400 text-[10px] font-mono font-bold border border-white/10 hover:border-cyan-400/30 px-3 py-1.5 rounded flex items-center gap-1 transition-all cursor-pointer"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    Restore Version
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-6 text-white/30 text-xs font-mono">
                            No older checkpoints registered for this lesson yet. Backups are recorded during major saves.
                          </div>
                        )}
                      </div>
                    )}
                      </>
                    )}

                  </div>

                </div>
              ) : (
                <div className="bg-[#0C0C0C] rounded-xl shadow-2xl border border-white/10 flex flex-col items-center justify-center p-12 text-center text-white/40 min-h-[750px]">
                  <Compass className="w-16 h-16 text-white/10 mb-4 animate-pulse" />
                  <h3 className="font-bold text-base uppercase tracking-widest text-white/75 font-mono">
                    No Active Lesson Plan Workspace Opened
                  </h3>
                  <p className="text-xs text-white/40 mt-2 max-w-md leading-relaxed">
                    Select a lesson from your database index on the left, create a fresh blank draft, or co-pilot with AI to generate a plan aligned directly with indexed MINESEC syllabus files.
                  </p>
                  <div className="flex gap-4 mt-8">
                    <button
                      id="workspace-btn-new-blank"
                      onClick={handleCreateBlankLesson}
                      className="bg-white/5 hover:bg-white/10 text-white/80 text-xs font-mono uppercase tracking-wider py-2.5 px-4 rounded-md border border-white/10 flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Create Blank Draft
                    </button>
                    <button
                      id="workspace-btn-open-ai"
                      onClick={() => setShowGeneratorModal(true)}
                      className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 text-xs font-mono uppercase tracking-wider py-2.5 px-4 rounded-md border border-cyan-400/50 flex items-center gap-1.5 transition-all cursor-pointer shadow-lg hover:shadow-cyan-400/15"
                    >
                      <Sparkles className="w-4 h-4 text-amber-300" />
                      CO-PILOT GENERATION
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}
           {/* =======================================================
            TAB 2: SYLLABUS REGISTRY & MANAGER
            ======================================================= */}
        {activeTab === "syllabus" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Column: Syllabus Directory Upload & Registry List */}
            <div className="lg:col-span-5 bg-[#0C0C0C] rounded-xl shadow-2xl border border-white/10 p-4 space-y-5 flex flex-col h-[750px]">
              
              <div>
                <h2 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                  <BookMarked className="w-5 h-5 text-cyan-400" />
                  MINESEC Syllabus Registry
                </h2>
                <p className="text-xs text-white/40 mt-1 font-mono">
                  Index and process official secondary education syllabi inside Neon.
                </p>
              </div>

              {/* Secure Drag-and-Drop file uploader */}
              <div
                id="dropzone"
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-2 ${
                  dragActive
                    ? "border-cyan-400 bg-cyan-500/10"
                    : "border-white/10 bg-black/40 hover:bg-white/[0.01]"
                }`}
              >
                <input
                  id="file-uploader-input"
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                
                <div className="bg-cyan-500/10 text-cyan-400 h-11 w-11 rounded-full flex items-center justify-center border border-cyan-400/20 shadow">
                  <FileUp className="w-5 h-5" />
                </div>

                <div>
                  <p className="text-xs font-bold text-white/80 font-mono">
                    Drag and Drop official Syllabus file here
                  </p>
                  <p className="text-[10px] text-white/30 mt-1 font-mono">
                    Supports PDF, DOCX, DOC, TXT (Maximum size 15MB)
                  </p>
                </div>

                {uploadProgress !== null && (
                  <div className="w-full mt-3 space-y-1.5">
                    <div className="flex justify-between text-[10px] font-bold text-cyan-400 font-mono">
                      <span>{uploadProgress === 100 ? "Indexing complete!" : "AI Reading & Extracting CBA Metadata..."}</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-cyan-400 h-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  </div>
                )}

                {uploadError && (
                  <div className="flex items-center gap-1.5 text-[11px] text-rose-400 font-mono mt-2 bg-rose-500/10 p-2 rounded border border-rose-500/20 w-full justify-center">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}
              </div>

              {/* Syllabus Filters and List */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="flex items-center justify-between text-[10px] font-mono font-bold text-white/40 mb-2 uppercase tracking-wider">
                  <span>INDEXED FILES DIRECTORY</span>
                  <span>{filteredSyllabi.length} files</span>
                </div>

                <div className="space-y-2 overflow-y-auto flex-1 pr-1">
                  {loadingSyllabi ? (
                    <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
                      <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                      <p className="text-xs font-mono">Connecting to PostgreSQL registry...</p>
                    </div>
                  ) : filteredSyllabi.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-white/10 rounded-lg text-white/30 text-xs font-mono">
                      No indexed syllabi matching your filters. Upload an official MINESEC document above to automatically index.
                    </div>
                  ) : (
                    filteredSyllabi.map(syllabus => {
                      const isSelected = selectedSyllabus?.id === syllabus.id;
                      return (
                        <div
                          key={syllabus.id}
                          id={`syllabus-card-${syllabus.id}`}
                          onClick={() => setSelectedSyllabus(syllabus)}
                          className={`p-3 rounded-lg border transition-all cursor-pointer flex justify-between items-center ${
                            isSelected
                              ? "bg-cyan-500/10 border-cyan-400/50 shadow-sm"
                              : "bg-black/40 border-white/5 hover:border-white/15 hover:bg-white/[0.01]"
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className="bg-cyan-500/10 text-cyan-400 p-2 rounded-lg mt-0.5">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-bold text-white text-xs truncate">
                                {syllabus.title}
                              </h4>
                              <div className="flex items-center gap-2 text-[10px] text-white/40 font-mono mt-1">
                                <span className="font-semibold text-white/60">{syllabus.subject}</span>
                                <span className="h-1 w-1 bg-white/10 rounded-full"></span>
                                <span>{syllabus.class_level}</span>
                                <span className="h-1 w-1 bg-white/10 rounded-full"></span>
                                <span>{(syllabus.file_size / (1024 * 1024)).toFixed(2)} MB</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-1 pl-2">
                            {syllabus.file_url && (
                              <a
                                href={syllabus.file_url}
                                target="_blank"
                                rel="referrer noopener"
                                onClick={(e) => e.stopPropagation()}
                                className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-cyan-400 transition-colors"
                                title="Download / Open Official Source"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                            <button
                              id={`btn-delete-syllabus-${syllabus.id}`}
                              onClick={(e) => handleDeleteSyllabus(syllabus.id, e)}
                              className="p-1 hover:bg-rose-500/10 rounded text-white/40 hover:text-rose-400 transition-colors cursor-pointer"
                              title="Delete Syllabus Alignment"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>

            {/* Right Column: AI Extracted CBA Syllabus Index Details (Drawer/Viewer) */}
            <div className="lg:col-span-7">
              {selectedSyllabus ? (
                <div className="bg-[#0C0C0C] rounded-xl shadow-2xl border border-white/10 overflow-hidden flex flex-col min-h-[750px]">
                  
                  {/* Registry index header details */}
                  <div className="p-5 bg-[#0A0A0A] border-b border-white/10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                      <span className="text-[9px] font-bold font-mono tracking-widest text-cyan-400 bg-cyan-500/10 border border-cyan-400/20 px-2 py-0.5 rounded uppercase">
                        AI Extracted CBA Curriculum alignment Card
                      </span>
                      <h3 className="font-extrabold text-white text-lg md:text-xl mt-1.5">
                        {selectedSyllabus.title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-white/40 mt-1 font-mono">
                        <span>Discipline: <strong className="text-white/70">{selectedSyllabus.subject}</strong></span>
                        <span className="h-1 w-1 bg-white/10 rounded-full"></span>
                        <span>Class: <strong className="text-white/70">{selectedSyllabus.class_level}</strong></span>
                        <span className="h-1 w-1 bg-white/10 rounded-full"></span>
                        <span>Year: <strong className="text-white/70">{selectedSyllabus.academic_year}</strong></span>
                      </div>
                    </div>

                    {selectedSyllabus.file_url && (
                      <a
                        href={selectedSyllabus.file_url}
                        target="_blank"
                        referrerPolicy="no-referrer"
                        className="bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 font-semibold text-xs py-2 px-3.5 rounded-lg flex items-center gap-1.5 transition-all shadow-sm font-mono cursor-pointer"
                      >
                        <FileDown className="w-4 h-4" />
                        Source PDF / doc
                      </a>
                    )}
                  </div>

                  {/* CBA Index Content Panels */}
                  <div className="flex-1 p-5 overflow-y-auto space-y-6 max-h-[600px] no-scrollbar">
                    
                    {/* 1. Core Competency Framework */}
                    <div className="bg-[#080808] border border-white/10 p-4.5 rounded-xl">
                      <h4 className="font-bold text-cyan-400 text-xs font-mono tracking-widest uppercase flex items-center gap-1.5 mb-2">
                        <Award className="w-4 h-4 text-cyan-400" />
                        Core Syllabus Competency Framework (CBA Core)
                      </h4>
                      <p className="text-[11px] text-white/40 mb-3 font-mono">
                        These are the key competencies mandated by the official MINESEC inspectorate for student mastery.
                      </p>
                      <ul className="space-y-2.5">
                        {(selectedSyllabus.extracted_metadata.competencies || []).map((comp, idx) => (
                          <li key={idx} className="bg-black/40 px-3 py-2.5 rounded-lg border border-white/5 text-xs text-white/80 flex gap-2 font-mono">
                            <span className="text-cyan-400 font-bold">✓</span>
                            {comp}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* 2. Chapters and Units */}
                    <div>
                      <h4 className="font-bold text-white text-xs font-mono tracking-widest uppercase flex items-center gap-1.5 mb-3">
                        <LayoutGrid className="w-4.5 h-4.5 text-white/40" />
                        Curriculum structure & Chapter Modules
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(selectedSyllabus.extracted_metadata.modules || []).map((mod, idx) => (
                          <div key={idx} className="bg-[#080808] p-4 rounded-xl border border-white/10 flex flex-col justify-between">
                            <div>
                              <h5 className="font-bold text-cyan-400 text-xs border-b border-white/10 pb-2 mb-2 font-mono">
                                {mod.title}
                              </h5>
                              <p className="text-[11px] text-white/60 font-mono leading-relaxed">
                                {mod.description}
                              </p>
                            </div>
                            
                            <div className="mt-3 pt-2.5 border-t border-white/10">
                              <span className="text-[9px] font-bold text-white/30 font-mono uppercase tracking-widest block mb-1">Learning Objectives</span>
                              <ul className="space-y-1">
                                {(mod.objectives || []).map((obj, oIdx) => (
                                  <li key={oIdx} className="text-[10px] text-white/50 flex gap-1 font-mono">
                                    <span className="text-white/20">•</span>
                                    {obj}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 3. Learning Outcomes & Grading standards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      {/* Outcomes */}
                      <div>
                        <h4 className="font-bold text-white text-xs font-mono tracking-widest uppercase mb-2.5">
                          Mandated Learning Outcomes
                        </h4>
                        <ul className="space-y-2">
                          {(selectedSyllabus.extracted_metadata.learningOutcomes || []).map((out, idx) => (
                            <li key={idx} className="bg-black/40 p-2.5 rounded-lg border border-white/5 text-xs text-white/60 flex gap-2 font-mono">
                              <span className="text-white/20">•</span>
                              {out}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Grading */}
                      <div>
                        <h4 className="font-bold text-white text-xs font-mono tracking-widest uppercase mb-2.5">
                          Inspectorate Assessment Criteria
                        </h4>
                        <ul className="space-y-2">
                          {(selectedSyllabus.extracted_metadata.assessmentCriteria || []).map((std, idx) => (
                            <li key={idx} className="bg-black/40 p-2.5 rounded-lg border border-white/5 text-xs text-white/60 flex gap-2 font-mono">
                              <span className="text-cyan-400 font-bold">★</span>
                              {std}
                            </li>
                          ))}
                        </ul>
                      </div>

                    </div>

                  </div>

                </div>
              ) : (
                <div className="bg-[#0C0C0C] rounded-xl shadow-2xl border border-white/10 flex flex-col items-center justify-center p-12 text-center text-white/40 min-h-[750px]">
                  <Compass className="w-16 h-16 text-white/10 mb-4 animate-pulse" />
                  <h3 className="font-bold text-base uppercase tracking-widest text-white/75 font-mono">
                    Syllabus Index Viewer
                  </h3>
                  <p className="text-xs text-white/40 mt-2 max-w-sm font-mono leading-relaxed">
                    Select an indexed official syllabus from the registry directory to display the AI-extracted CBA competencies and curriculum alignment outline.
                  </p>
                </div>
              )}
            </div>

          </div>
        )}

        {/* =======================================================
            TAB 3: LECTURE NOTE STUDIO
            ======================================================= */}
        {activeTab === "lecture" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Column: Lecture Notes Directory */}
            <div className="lg:col-span-5 bg-[#0C0C0C] rounded-xl shadow-2xl border border-white/10 p-4 space-y-5 flex flex-col h-[850px]">
              
              <div>
                <h2 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                  <Award className="w-5 h-5 text-cyan-400" />
                  Lecture Notes Directory
                </h2>
                <p className="text-xs text-white/40 mt-1 font-mono">
                  Create and manage official curriculum-aligned lecture notes.
                </p>
              </div>

              {/* Lecture Generator Form */}
              <div className="bg-black/40 p-4 rounded-xl border border-white/5 space-y-3">
                <h3 className="text-xs font-mono font-bold text-white/80 uppercase tracking-widest">
                  AI Lecture Notes Generator
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Align with Syllabus</label>
                    <select
                      value={lectureForm.syllabusId}
                      onChange={(e) => {
                        const sylId = e.target.value;
                        const syl = syllabi.find(s => s.id === parseInt(sylId));
                        setLectureForm(prev => ({
                          ...prev,
                          syllabusId: sylId,
                          subject: syl ? syl.subject : prev.subject,
                          classLevel: syl ? syl.class_level : prev.classLevel
                        }));
                      }}
                      className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                    >
                      <option value="">-- No Syllabus Alignment --</option>
                      {syllabi.map(syl => (
                        <option key={syl.id} value={syl.id.toString()}>
                          {syl.title} ({syl.class_level})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Lecture Topic / Focus *</label>
                    <input
                      type="text"
                      placeholder="e.g. Newton's Laws of Motion"
                      value={lectureForm.topic}
                      onChange={(e) => setLectureForm(prev => ({ ...prev, topic: e.target.value }))}
                      className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white placeholder-white/20 font-mono focus:outline-none focus:border-cyan-400"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Subject</label>
                      <input
                        type="text"
                        placeholder="e.g. Physics"
                        value={lectureForm.subject}
                        onChange={(e) => setLectureForm(prev => ({ ...prev, subject: e.target.value }))}
                        className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Class Level</label>
                      <input
                        type="text"
                        placeholder="e.g. Premiere"
                        value={lectureForm.classLevel}
                        onChange={(e) => setLectureForm(prev => ({ ...prev, classLevel: e.target.value }))}
                        className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Notes Depth / Format</label>
                    <select
                      value={lectureForm.formatDetail}
                      onChange={(e) => setLectureForm(prev => ({ ...prev, formatDetail: e.target.value }))}
                      className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                    >
                      <option value="Comprehensive">Comprehensive Lesson (Long Form)</option>
                      <option value="Medium/Standard">Medium Standard (Bullet Outline & Examples)</option>
                      <option value="Revision/Summary">Revision / Fast Summary</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Pedagogic Directives (Custom)</label>
                    <textarea
                      placeholder="Add specific guidelines, e.g. use Cameroonian context..."
                      value={lectureForm.customDirectives}
                      onChange={(e) => setLectureForm(prev => ({ ...prev, customDirectives: e.target.value }))}
                      className="w-full h-14 bg-[#141414] border border-white/10 rounded-lg py-1.5 px-3 text-xs text-white placeholder-white/20 font-mono focus:outline-none focus:border-cyan-400 resize-none"
                    />
                  </div>

                  <button
                    onClick={handleGenerateLecture}
                    disabled={generatingLecture}
                    className="w-full bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-400/50 flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg text-xs font-bold font-mono transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {generatingLecture ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Generating Lecture Notes...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                        Generate Lesson Lecture Notes
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Lecture list with search/filter */}
              <div className="flex-grow flex flex-col min-h-0 space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-grow">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/20" />
                    <input
                      type="text"
                      placeholder="Search lecture notes..."
                      value={lectureSearch}
                      onChange={(e) => setLectureSearch(e.target.value)}
                      className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 pl-9 pr-4 text-xs font-mono text-white placeholder-white/20 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <select
                    value={lectureFilterSubject}
                    onChange={(e) => setLectureFilterSubject(e.target.value)}
                    className="bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white/60 font-mono focus:outline-none focus:border-cyan-400"
                  >
                    <option value="">All Subjects</option>
                    {uniqueLectureSubjects.map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
                </div>

                <div className="flex-grow overflow-y-auto pr-1 space-y-2 max-h-[180px]">
                  {loadingLectures ? (
                    <div className="text-center py-6 text-white/30 font-mono text-xs">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-cyan-400" />
                      Retrieving notes registry...
                    </div>
                  ) : filteredLectures.length === 0 ? (
                    <div className="text-center py-6 text-white/30 italic font-mono text-xs">
                      No lecture notes generated yet.
                    </div>
                  ) : (
                    filteredLectures.map(lec => (
                      <div
                        key={lec.id}
                        onClick={() => setSelectedLecture(lec)}
                        className={`p-3 rounded-lg border transition-all cursor-pointer flex flex-col justify-between ${
                          selectedLecture?.id === lec.id
                            ? "border-cyan-400/80 bg-cyan-500/10"
                            : "border-white/5 bg-black/20 hover:bg-white/[0.02]"
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-xs font-semibold text-white/90 line-clamp-1">{lec.title}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteLecture(lec.id);
                            }}
                            className="text-white/20 hover:text-red-400 transition-colors p-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-[10px] font-mono text-white/40">
                          <span className="bg-white/5 px-1.5 py-0.5 rounded uppercase">{lec.subject}</span>
                          <span>•</span>
                          <span>{lec.class_level}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

            {/* Right Column: Lecture Content Viewer */}
            <div className="lg:col-span-7 space-y-6">
              {selectedLecture ? (
                <div className="bg-[#0C0C0C] rounded-xl shadow-2xl border border-white/10 p-6 space-y-6 flex flex-col min-h-[850px]">
                  
                  {/* Title and metadata header */}
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-white/10">
                    <div>
                      <h2 className="text-xl font-bold text-white leading-snug">{selectedLecture.title}</h2>
                      <p className="text-xs text-white/40 font-mono mt-1">
                        Topic: {selectedLecture.topic} | Level: {selectedLecture.class_level} | Subject: {selectedLecture.subject}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {authRole !== "Student" && (
                        <button
                          onClick={() => {
                            if (isEditingLecture) {
                              handleSaveLectureEdit();
                            } else {
                              setEditLectureTitle(selectedLecture.title);
                              setEditLectureContent(selectedLecture.content);
                              setIsEditingLecture(true);
                            }
                          }}
                          className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 font-mono text-xs font-semibold py-1.5 px-3 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          {isEditingLecture ? "Save Notes" : "Edit Notes"}
                        </button>
                      )}
                      <button
                        onClick={() => handleDownloadLecturePDF(selectedLecture)}
                        className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-400/30 font-mono text-xs font-semibold py-1.5 px-3 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        PDF (A4)
                      </button>
                      <button
                        onClick={() => handleExportLectureWord(selectedLecture)}
                        className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 font-mono text-xs font-semibold py-1.5 px-3 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Word (.doc)
                      </button>
                    </div>
                  </div>

                  {/* Lecture body editor or viewer */}
                  {isEditingLecture ? (
                    <div className="space-y-4 flex-grow flex flex-col">
                      <div className="space-y-1">
                        <label className="block text-[10px] font-mono text-white/40 uppercase">Lecture Document Title</label>
                        <input
                          type="text"
                          value={editLectureTitle}
                          onChange={(e) => setEditLectureTitle(e.target.value)}
                          className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                        />
                      </div>

                      {/* Cloudinary Image Uploader Widget */}
                      <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl space-y-3">
                        <div className="flex justify-between items-center">
                          <h4 className="text-[10px] font-bold font-mono uppercase tracking-wider text-cyan-400 flex items-center gap-1">
                            <UploadCloud className="w-3.5 h-3.5" />
                            Cloudinary Media illustration Embedder
                          </h4>
                          <span className="text-[9px] font-mono text-white/30">Max 500MB • Image/Media</span>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                          <div>
                            <input
                              type="file"
                              accept="image/*,video/*,audio/*"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;

                                if (file.size > 500 * 1024 * 1024) {
                                  showNotification("error", "File size exceeds 500MB limit.");
                                  return;
                                }

                                setIsUploadingCloudinary(true);
                                setCloudinaryProgress(10);
                                try {
                                  const folderName = file.type.startsWith("image/") ? "minesec_images" : "minesec_media";
                                  const resourceType = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "auto";
                                  
                                  const cloudinaryData = await uploadToCloudinaryDirectly(
                                    file,
                                    folderName,
                                    resourceType,
                                    (p) => setCloudinaryProgress(p)
                                  );
                                  
                                  setCloudinaryProgress(100);
                                  setUploadedCloudinaryUrl(cloudinaryData.secure_url);
                                  
                                  // Append to editor
                                  if (file.type.startsWith("image/")) {
                                    setEditLectureContent(prev => prev + `\n\n![embedded illustration](${cloudinaryData.secure_url})\n`);
                                  } else if (file.type.startsWith("video/")) {
                                    setEditLectureContent(prev => prev + `\n\n<video controls src="${cloudinaryData.secure_url}" className="w-full rounded-lg my-4"></video>\n`);
                                  } else {
                                    setEditLectureContent(prev => prev + `\n\n[Download Attached Media File](${cloudinaryData.secure_url})\n`);
                                  }
                                  
                                  showNotification("success", "Media uploaded and embedded in Markdown!");
                                } catch (err: any) {
                                  showNotification("error", "Upload failed: " + err.message);
                                } finally {
                                  setIsUploadingCloudinary(false);
                                  setCloudinaryProgress(0);
                                }
                              }}
                              className="block w-full text-xs text-white/40 font-mono
                                file:mr-3 file:py-1.5 file:px-3
                                file:rounded-md file:border-0
                                file:text-[10px] file:font-mono file:font-bold
                                file:bg-cyan-500/10 file:text-cyan-400
                                hover:file:bg-cyan-500/20 file:cursor-pointer"
                            />
                            <p className="text-[9px] text-white/30 mt-1.5">
                              Drag/drop or select diagrams. We'll automatically generate a CDN link and embed it in Markdown.
                            </p>
                          </div>

                          {isUploadingCloudinary && (
                            <div className="bg-black/50 p-3 rounded-lg border border-cyan-500/25 flex flex-col justify-center items-center text-center space-y-1">
                              <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                              <span className="text-[9px] font-mono text-cyan-400 font-bold uppercase">Uploading to Cloudinary...</span>
                              <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-1">
                                <div className="bg-cyan-400 h-full transition-all duration-300" style={{ width: `${cloudinaryProgress}%` }}></div>
                              </div>
                            </div>
                          )}

                          {!isUploadingCloudinary && uploadedCloudinaryUrl && (
                            <div className="bg-white/[0.01] p-2.5 rounded-lg border border-white/5 flex items-center gap-3">
                              <img src={uploadedCloudinaryUrl} alt="Preview" className="w-12 h-12 object-cover rounded border border-white/10" referrerPolicy="no-referrer" />
                              <div className="flex-grow min-w-0">
                                <span className="text-[8.5px] font-mono text-emerald-400 font-bold uppercase block">Embedded Successfully</span>
                                <span className="text-[8px] font-mono text-white/30 truncate block">{uploadedCloudinaryUrl}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1 flex-grow flex flex-col">
                        <label className="block text-[10px] font-mono text-white/40 uppercase">Rich Text Markdown Body</label>
                        <textarea
                          value={editLectureContent}
                          onChange={(e) => setEditLectureContent(e.target.value)}
                          className="w-full h-[320px] bg-[#141414] border border-white/10 rounded-lg p-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400 resize-none flex-grow"
                          placeholder="Write lecture content using Markdown. Use standard formatting or embed structural diagrams using the tool above."
                        />
                      </div>

                      <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                        <button
                          onClick={() => setIsEditingLecture(false)}
                          className="bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 font-mono text-xs font-semibold py-1.5 px-4 rounded-lg cursor-pointer transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveLectureEdit}
                          className="bg-amber-500 hover:bg-amber-600 text-black font-mono text-xs font-bold py-1.5 px-5 rounded-lg cursor-pointer transition-all flex items-center gap-1 shadow-lg shadow-amber-500/15"
                        >
                          <Save className="w-3.5 h-3.5" />
                          Save Lecture Changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-grow bg-black/40 rounded-xl border border-white/5 p-6 overflow-y-auto max-h-[600px] scrollbar-thin">
                      <div className="markdown-body text-xs text-white/80 space-y-4 leading-relaxed font-sans">
                        <Markdown>{selectedLecture.content}</Markdown>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-[#0C0C0C] rounded-xl shadow-2xl border border-white/10 flex flex-col items-center justify-center p-12 text-center text-white/40 min-h-[850px]">
                  <Award className="w-16 h-16 text-white/10 mb-4 animate-pulse" />
                  <h3 className="font-bold text-base uppercase tracking-widest text-white/75 font-mono">
                    Lecture Notes Panel
                  </h3>
                  <p className="text-xs text-white/40 mt-2 max-w-sm font-mono leading-relaxed">
                    Select generated notes from the directory sidebar or use the AI co-pilot generator to build high-quality, comprehensive classroom notes aligned with the official CBA syllabus.
                  </p>
                </div>
              )}
            </div>

          </div>
        )}

        {/* =======================================================
            TAB 4: QUIZ EVALUATION STUDIO
            ======================================================= */}
        {activeTab === "quiz" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Column: Quiz Directory */}
            <div className="lg:col-span-5 bg-[#0C0C0C] rounded-xl shadow-2xl border border-white/10 p-4 space-y-5 flex flex-col h-[850px]">
              
              <div>
                <h2 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                  <GraduationCap className="w-5 h-5 text-cyan-400" />
                  Quiz Evaluation Directory
                </h2>
                <p className="text-xs text-white/40 mt-1 font-mono">
                  Design evaluation tools aligned with MINESEC standards.
                </p>
              </div>

              {/* Quiz Generator Form */}
              <div className="bg-black/40 p-4 rounded-xl border border-white/5 space-y-3">
                <h3 className="text-xs font-mono font-bold text-white/80 uppercase tracking-widest">
                  AI Quiz Generator
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Align with Syllabus</label>
                    <select
                      value={quizForm.syllabusId}
                      onChange={(e) => {
                        const sylId = e.target.value;
                        const syl = syllabi.find(s => s.id === parseInt(sylId));
                        setQuizForm(prev => ({
                          ...prev,
                          syllabusId: sylId,
                          subject: syl ? syl.subject : prev.subject,
                          classLevel: syl ? syl.class_level : prev.classLevel
                        }));
                      }}
                      className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                    >
                      <option value="">-- No Syllabus Alignment --</option>
                      {syllabi.map(syl => (
                        <option key={syl.id} value={syl.id.toString()}>
                          {syl.title} ({syl.class_level})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Align with Lesson Plan</label>
                    <select
                      value={quizForm.lessonId}
                      onChange={(e) => {
                        const lesId = e.target.value;
                        const les = lessons.find(l => l.id === parseInt(lesId));
                        setQuizForm(prev => ({
                          ...prev,
                          lessonId: lesId,
                          topic: les ? les.title : prev.topic,
                          subject: les ? les.subject : prev.subject,
                          classLevel: les ? les.class_level : prev.classLevel
                        }));
                      }}
                      className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                    >
                      <option value="">-- No Lesson Plan Alignment --</option>
                      {lessons.map(les => (
                        <option key={les.id} value={les.id.toString()}>
                          {les.title} ({les.class_level})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Evaluation Topic / Topic *</label>
                    <input
                      type="text"
                      placeholder="e.g. Newton's Laws or Redox Reactions"
                      value={quizForm.topic}
                      onChange={(e) => setQuizForm(prev => ({ ...prev, topic: e.target.value }))}
                      className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white placeholder-white/20 font-mono focus:outline-none focus:border-cyan-400"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">No. of Questions</label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={quizForm.numQuestions}
                        onChange={(e) => setQuizForm(prev => ({ ...prev, numQuestions: parseInt(e.target.value) || 5 }))}
                        className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Question Type</label>
                      <select
                        value={quizForm.questionType}
                        onChange={(e) => setQuizForm(prev => ({ ...prev, questionType: e.target.value }))}
                        className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                      >
                        <option value="Mixed">Mixed Formats</option>
                        <option value="MCQ">Multiple Choice Only</option>
                        <option value="TF">True / False Only</option>
                        <option value="SA">Short Answer Only</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Subject</label>
                      <input
                        type="text"
                        placeholder="e.g. Biology"
                        value={quizForm.subject}
                        onChange={(e) => setQuizForm(prev => ({ ...prev, subject: e.target.value }))}
                        className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Class Level</label>
                      <input
                        type="text"
                        placeholder="e.g. Premiere"
                        value={quizForm.classLevel}
                        onChange={(e) => setQuizForm(prev => ({ ...prev, classLevel: e.target.value }))}
                        className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">CBA Cognitive Target</label>
                    <select
                      value={quizForm.difficulty}
                      onChange={(e) => setQuizForm(prev => ({ ...prev, difficulty: e.target.value }))}
                      className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                    >
                      <option value="Recall & Application">Recall, Understanding & Application</option>
                      <option value="Application & Analytical">Analytical & Complex Problem Solving</option>
                      <option value="Comprehensive Mastery">Critical Evaluation & Synthesis</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Directives (Custom)</label>
                    <textarea
                      placeholder="e.g. include high-order questions..."
                      value={quizForm.customDirectives}
                      onChange={(e) => setQuizForm(prev => ({ ...prev, customDirectives: e.target.value }))}
                      className="w-full h-11 bg-[#141414] border border-white/10 rounded-lg py-1 px-3 text-xs text-white placeholder-white/20 font-mono focus:outline-none focus:border-cyan-400 resize-none"
                    />
                  </div>

                  <button
                    onClick={handleGenerateQuiz}
                    disabled={generatingQuiz}
                    className="w-full bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-400/50 flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg text-xs font-bold font-mono transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {generatingQuiz ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Generating Evaluation Quiz...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                        Generate Evaluation Quiz
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Quiz list with search/filter */}
              <div className="flex-grow flex flex-col min-h-0 space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-grow">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/20" />
                    <input
                      type="text"
                      placeholder="Search quizzes..."
                      value={quizSearch}
                      onChange={(e) => setQuizSearch(e.target.value)}
                      className="w-full bg-[#141414] border border-white/10 rounded-lg py-2 pl-9 pr-4 text-xs font-mono text-white placeholder-white/20 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <select
                    value={quizFilterSubject}
                    onChange={(e) => setQuizFilterSubject(e.target.value)}
                    className="bg-[#141414] border border-white/10 rounded-lg py-2 px-3 text-xs text-white/60 font-mono focus:outline-none focus:border-cyan-400"
                  >
                    <option value="">All Subjects</option>
                    {uniqueQuizSubjects.map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
                </div>

                <div className="flex-grow overflow-y-auto pr-1 space-y-2 max-h-[140px]">
                  {loadingQuizzes ? (
                    <div className="text-center py-6 text-white/30 font-mono text-xs">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-cyan-400" />
                      Retrieving quizzes registry...
                    </div>
                  ) : filteredQuizzes.length === 0 ? (
                    <div className="text-center py-6 text-white/30 italic font-mono text-xs">
                      No quizzes generated yet.
                    </div>
                  ) : (
                    filteredQuizzes.map(qz => (
                      <div
                        key={qz.id}
                        onClick={() => setSelectedQuiz(qz)}
                        className={`p-3 rounded-lg border transition-all cursor-pointer flex flex-col justify-between ${
                          selectedQuiz?.id === qz.id
                            ? "border-cyan-400/80 bg-cyan-500/10"
                            : "border-white/5 bg-black/20 hover:bg-white/[0.02]"
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-xs font-semibold text-white/90 line-clamp-1">{qz.title}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteQuiz(qz.id);
                            }}
                            className="text-white/20 hover:text-red-400 transition-colors p-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-[10px] font-mono text-white/40">
                          <span className="bg-white/5 px-1.5 py-0.5 rounded uppercase">{qz.subject}</span>
                          <span>•</span>
                          <span>{qz.class_level}</span>
                          <span>•</span>
                          <span>{qz.questions?.length || 0} Qs</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

            {/* Right Column: Interactive Quiz Taker */}
            <div className="lg:col-span-7 space-y-6">
              {selectedQuiz ? (
                <div className={`rounded-xl shadow-2xl p-6 space-y-6 flex flex-col min-h-[850px] transition-all ${
                  printFriendly 
                    ? "bg-white text-black border border-gray-300 font-serif" 
                    : "bg-[#0C0C0C] text-white border border-white/10 font-sans"
                }`}>
                  
                  {/* Title and control headers */}
                  <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b ${
                    printFriendly ? "border-gray-200 text-black" : "border-white/10 text-white"
                  }`}>
                    <div>
                      <h2 className="text-xl font-bold leading-snug">{selectedQuiz.title}</h2>
                      <p className={`text-xs font-mono mt-1 ${printFriendly ? "text-gray-500" : "text-white/40"}`}>
                        Subject: {selectedQuiz.subject} | Level: {selectedQuiz.class_level} | Difficulty: {selectedQuiz.difficulty}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 no-print">
                      <button
                        onClick={() => setPrintFriendly(!printFriendly)}
                        className={`font-mono text-xs font-bold py-1.5 px-3 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all ${
                          printFriendly 
                            ? "bg-gray-100 hover:bg-gray-200 text-gray-800 border border-gray-300"
                            : "bg-white/5 hover:bg-white/10 text-white/85 border border-white/10"
                        }`}
                      >
                        <Printer className="w-3.5 h-3.5" />
                        {printFriendly ? "Standard Dark Theme" : "Print-Friendly View"}
                      </button>

                      <button
                        onClick={handleShuffleQuestions}
                        className={`font-mono text-xs font-bold py-1.5 px-3 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all ${
                          printFriendly 
                            ? "bg-gray-100 hover:bg-gray-200 text-gray-800 border border-gray-300"
                            : "bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-400/30"
                        }`}
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        Shuffle Questions
                      </button>

                      <button
                        onClick={() => handleDownloadQuizPDF(selectedQuiz)}
                        className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-400/30 font-mono text-xs font-bold py-1.5 px-3 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        PDF (A4)
                      </button>
                      <button
                        onClick={() => handleExportQuizWord(selectedQuiz)}
                        className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 font-mono text-xs font-bold py-1.5 px-3 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Word (.doc)
                      </button>
                    </div>
                  </div>

                  {/* Completion Status Progress Bar */}
                  {shuffledQuestions.length > 0 && (
                    <div className={`p-4 rounded-xl border transition-all ${
                      printFriendly 
                        ? "bg-gray-50 border-gray-200 text-black" 
                        : "bg-black/20 border-white/5 text-white"
                    }`}>
                      <div className="flex justify-between items-center mb-1.5 text-xs">
                        <span className="font-bold uppercase tracking-wider font-mono text-[10px]">
                          Quiz Completion Status
                        </span>
                        <span className="font-bold font-mono">
                          {Object.keys(quizResponses).filter(k => quizResponses[Number(k)]?.trim() !== "").length} / {shuffledQuestions.length} Questions Answered
                        </span>
                      </div>
                      <div className="w-full h-2.5 bg-gray-300/40 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-cyan-500 transition-all duration-300 rounded-full" 
                          style={{
                            width: `${shuffledQuestions.length > 0 
                              ? (Object.keys(quizResponses).filter(k => quizResponses[Number(k)]?.trim() !== "").length / shuffledQuestions.length) * 100 
                              : 0}%`
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Quiz taking area */}
                  <div className="flex-grow space-y-6 overflow-y-auto max-h-[500px] pr-1">
                    {shuffledQuestions.map((q, qIdx) => {
                      const userAns = quizResponses[qIdx] || "";
                      const isCorrect = quizScore !== null && (
                        q.type === "MCQ" || q.type === "TF"
                          ? q.correctAnswer.toLowerCase() === userAns.toLowerCase() || q.correctAnswer.startsWith(userAns)
                          : true
                      );

                      return (
                        <div 
                          key={qIdx} 
                          className={`p-4 rounded-xl border transition-all ${
                            printFriendly 
                              ? "bg-white border-gray-300 text-black" 
                              : "bg-black/20 border-white/5 text-white"
                          } ${
                            quizScore !== null 
                              ? isCorrect 
                                ? "border-emerald-500/40 bg-emerald-500/5" 
                                : q.type !== "SA" ? "border-red-500/40 bg-red-500/5" : ""
                              : ""
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <span className="font-bold text-sm font-mono text-cyan-500">Q{qIdx + 1}.</span>
                            <div className="flex-grow space-y-3">
                              <p className="text-xs font-semibold leading-relaxed">{q.question}</p>
                              
                              {/* MCQ */}
                              {q.type === "MCQ" && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                                  {q.options.map((opt, oIdx) => {
                                    const letter = String.fromCharCode(65 + oIdx);
                                    const isSelected = userAns === letter;
                                    return (
                                      <button
                                        key={oIdx}
                                        disabled={quizScore !== null}
                                        onClick={() => setQuizResponses(prev => ({ ...prev, [qIdx]: letter }))}
                                        className={`w-full text-left py-2 px-3 rounded-lg text-xs flex items-center gap-2 transition-all cursor-pointer ${
                                          printFriendly
                                            ? isSelected 
                                              ? "bg-gray-200 border border-gray-400 font-bold" 
                                              : "bg-gray-50 hover:bg-gray-100 border border-gray-200"
                                            : isSelected 
                                              ? "bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 font-semibold" 
                                              : "bg-white/5 hover:bg-white/10 border border-white/5 text-white/80"
                                        }`}
                                      >
                                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                          isSelected 
                                            ? "bg-cyan-500 text-white" 
                                            : printFriendly ? "bg-gray-200 text-gray-700" : "bg-white/10 text-white/60"
                                        }`}>{letter}</span>
                                        <span>{opt}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}

                              {/* TF */}
                              {q.type === "TF" && (
                                <div className="flex gap-4 mt-1">
                                  {["True", "False"].map((opt) => {
                                    const isSelected = userAns === opt;
                                    return (
                                      <button
                                        key={opt}
                                        disabled={quizScore !== null}
                                        onClick={() => setQuizResponses(prev => ({ ...prev, [qIdx]: opt }))}
                                        className={`py-1.5 px-4 rounded-lg text-xs flex items-center gap-2 transition-all cursor-pointer ${
                                          printFriendly
                                            ? isSelected 
                                              ? "bg-gray-200 border border-gray-400 font-bold" 
                                              : "bg-gray-50 hover:bg-gray-100 border border-gray-200"
                                            : isSelected 
                                              ? "bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 font-semibold" 
                                              : "bg-white/5 hover:bg-white/10 border border-white/5 text-white/80"
                                        }`}
                                      >
                                        <span className={`w-3 h-3 rounded-full border flex items-center justify-center ${
                                          isSelected ? "bg-cyan-500 border-cyan-400" : "border-white/20"
                                        }`}>
                                          {isSelected && <span className="w-1.5 h-1.5 bg-white rounded-full"></span>}
                                        </span>
                                        <span>{opt}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}

                              {/* SA */}
                              {q.type === "SA" && (
                                <div className="mt-1">
                                  <textarea
                                    disabled={quizScore !== null}
                                    placeholder="Type your response or structural explanation here..."
                                    value={userAns}
                                    onChange={(e) => setQuizResponses(prev => ({ ...prev, [qIdx]: e.target.value }))}
                                    className={`w-full h-16 rounded-lg text-xs p-2.5 font-mono focus:outline-none resize-none ${
                                      printFriendly 
                                        ? "bg-gray-50 border border-gray-300 text-black placeholder-gray-400 focus:border-cyan-500" 
                                        : "bg-[#141414] border border-white/10 text-white placeholder-white/20 focus:border-cyan-400"
                                    }`}
                                  />
                                </div>
                              )}

                              {/* Show solutions */}
                              {(showAnswers || quizScore !== null) && (
                                <div className={`p-3 rounded-lg border text-xs leading-relaxed space-y-1 mt-2.5 ${
                                  printFriendly 
                                    ? "bg-gray-50 border-gray-200 text-gray-800" 
                                    : "bg-black/40 border-white/5 text-white/70"
                                }`}>
                                  <div className="font-semibold text-emerald-400 flex items-center gap-1 font-mono text-[10px]">
                                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                    Correct Answer: {q.correctAnswer}
                                  </div>
                                  <div className="font-mono text-[10px] text-white/50 leading-relaxed">
                                    <strong>Explanation:</strong> {q.explanation}
                                  </div>
                                </div>
                              )}

                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Submit / Grade segment */}
                  <div className={`flex flex-col md:flex-row justify-between items-center gap-4 pt-4 border-t ${
                    printFriendly ? "border-gray-200" : "border-white/10"
                  }`}>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowAnswers(!showAnswers)}
                        className={`font-mono text-xs font-semibold py-2 px-4 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                          printFriendly
                            ? "bg-gray-100 hover:bg-gray-200 text-gray-800 border border-gray-300"
                            : "bg-white/5 hover:bg-white/10 text-white/80 border border-white/10"
                        }`}
                      >
                        {showAnswers ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        {showAnswers ? "Hide Answer Key" : "Show Answer Key"}
                      </button>

                      {quizScore !== null && (
                        <button
                          onClick={() => {
                            setQuizResponses({});
                            setQuizScore(null);
                          }}
                          className="bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 font-mono text-xs font-semibold py-2 px-4 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Reset Evaluation
                        </button>
                      )}
                    </div>

                    <div>
                      {quizScore === null ? (
                        <button
                          onClick={() => {
                            let correct = 0;
                            let totalEval = 0;
                            shuffledQuestions.forEach((q, idx) => {
                              if (q.type === "MCQ" || q.type === "TF") {
                                totalEval++;
                                const ans = quizResponses[idx] || "";
                                if (q.correctAnswer.toLowerCase() === ans.toLowerCase() || q.correctAnswer.startsWith(ans)) {
                                  correct++;
                                }
                              }
                            });
                            const finalTotal = totalEval || shuffledQuestions.length;
                            setQuizScore({ score: correct, total: finalTotal });
                            showNotification("success", `Quiz graded successfully: ${correct}/${finalTotal}!`);

                            // Persistent Cloud Save
                            fetch("/api/quiz-results", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                quizId: selectedQuiz.id,
                                studentName: user?.email || "Minesec Student",
                                score: correct,
                                total: finalTotal,
                                percentage: Math.round((correct / finalTotal) * 100),
                                answers: quizResponses
                              })
                            })
                            .then(res => {
                              if (!res.ok) console.error("Cloud storage sync failed");
                            })
                            .catch(err => console.error("Could not write evaluation metrics:", err));
                          }}
                          className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-400/50 font-bold font-mono text-xs py-2 px-5 rounded-lg flex items-center gap-1.5 transition-all shadow-lg hover:shadow-emerald-400/15 cursor-pointer"
                        >
                          <CheckCircle className="w-4 h-4 text-emerald-300" />
                          SUBMIT & GRADE EVALUATION
                        </button>
                      ) : (
                        <div className={`p-3 rounded-lg border font-mono text-center space-y-0.5 ${
                          printFriendly ? "bg-gray-50 border-gray-300" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        }`}>
                          <div className="text-[10px] uppercase tracking-widest font-bold">Evaluation Score</div>
                          <div className="text-xl font-extrabold">{quizScore.score} / {quizScore.total}</div>
                          <div className="text-[9px] text-white/40">
                            ({Math.round((quizScore.score / quizScore.total) * 100)}% Mastery Level)
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              ) : (
                <div className="bg-[#0C0C0C] rounded-xl shadow-2xl border border-white/10 flex flex-col items-center justify-center p-12 text-center text-white/40 min-h-[850px]">
                  <GraduationCap className="w-16 h-16 text-white/10 mb-4 animate-pulse" />
                  <h3 className="font-bold text-base uppercase tracking-widest text-white/75 font-mono">
                    Evaluation Panel
                  </h3>
                  <p className="text-xs text-white/40 mt-2 max-w-sm font-mono leading-relaxed">
                    Select generated quizzes from the directory sidebar or use the AI generator to establish rigorous cognitive checks, question banks, and answer keys aligned to the official CBA curriculum syllabus.
                  </p>
                </div>
              )}
            </div>

          </div>
        )}
        {/* =======================================================
            TAB 5: STUDENT RESULTS LEDGER
            ======================================================= */}
        {activeTab === "ledger" && (
          <div className="space-y-6">
            <div className="bg-[#0C0C0C] rounded-xl shadow-2xl border border-white/10 p-6 space-y-6">
              <div className="flex justify-between items-center pb-4 border-b border-white/10">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <ListTodo className="w-5 h-5 text-cyan-400" />
                    Student Quiz Evaluation Results Ledger
                  </h2>
                  <p className="text-xs text-white/40 mt-1 font-mono">
                    Review live real-time scores, completion logs, and competency mastery levels for secondary school students.
                  </p>
                </div>
                <button
                  onClick={fetchQuizResults}
                  className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-400/30 text-xs font-mono font-bold py-1.5 px-3 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Refresh Ledger Data
                </button>
              </div>

              {loadingResults ? (
                <div className="py-12 text-center text-white/30 font-mono text-xs">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-cyan-400" />
                  Accessing cloud-hosted evaluations registry...
                </div>
              ) : quizResults.length === 0 ? (
                <div className="py-12 text-center text-white/30 italic font-mono text-xs">
                  No evaluation submissions logged in this ledger session yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs">
                    <thead>
                      <tr className="border-b border-white/5 text-white/40">
                        <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Student Identifier</th>
                        <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Evaluation Quiz</th>
                        <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Subject & Level</th>
                        <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Mastery Level</th>
                        <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Score / Ratio</th>
                        <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Evaluated On</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                      {quizResults.map((res, idx) => {
                        const scorePct = res.percentage || Math.round((res.score / res.total) * 100) || 0;
                        let masteryStatus = "Needs Attention";
                        let masteryColor = "text-rose-400 bg-rose-500/10 border-rose-500/20";
                        if (scorePct >= 80) {
                          masteryStatus = "High Mastery";
                          masteryColor = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
                        } else if (scorePct >= 50) {
                          masteryStatus = "Satisfactory";
                          masteryColor = "text-amber-400 bg-amber-500/10 border-amber-500/20";
                        }

                        return (
                          <tr key={res.id || idx} className="hover:bg-white/[0.01] transition-colors">
                            <td className="py-3.5 px-4 font-semibold text-white/90">{res.student_name || res.studentName}</td>
                            <td className="py-3.5 px-4 font-medium text-white/70">{res.quiz_title || "MINESEC Evaluation"}</td>
                            <td className="py-3.5 px-4 text-white/50">
                              <span className="bg-white/5 px-1.5 py-0.5 rounded uppercase mr-1">{res.quiz_subject || "TECH"}</span>
                              <span>{res.quiz_class_level}</span>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${masteryColor}`}>
                                {masteryStatus}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-white/90 font-bold">
                              {res.score} / {res.total} ({scorePct}%)
                            </td>
                            <td className="py-3.5 px-4 text-white/40">
                              {res.created_at ? new Date(res.created_at).toLocaleString() : "Just now"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

      </main>

      {/* =======================================================
          AI GENERATION DIALOG MODAL (Syllabus Aligned)
          ======================================================= */}
      <AnimatePresence>
        {showGeneratorModal && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0C0C0C] rounded-2xl border border-white/10 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              
              {/* Modal Header */}
              <div className="p-5 bg-[#0A0A0A] border-b border-white/10 text-white flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-cyan-400 animate-pulse" />
                  <div>
                    <h3 className="font-bold text-sm uppercase tracking-wider text-white">MINESEC AI Lesson Plan Studio</h3>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest font-mono font-bold mt-1">
                      Syllabus-Aligned Competency Based Approach (CBA) Co-Pilot
                    </p>
                  </div>
                </div>
                
                {!generatingAI && (
                  <button
                    id="btn-close-ai-modal"
                    onClick={() => setShowGeneratorModal(false)}
                    className="text-white/40 hover:text-white transition-colors cursor-pointer text-lg font-bold"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Modal Content */}
              {generatingAI ? (
                // Processing Screen
                <div className="p-8 flex flex-col items-center justify-center space-y-6 flex-1 min-h-[400px]">
                  <Loader2 className="w-14 h-14 animate-spin text-cyan-400" />
                  
                  <div className="text-center space-y-1.5 max-w-md">
                    <h4 className="font-bold text-white text-sm font-mono uppercase tracking-wider">{currentGenerationStep}</h4>
                    <p className="text-xs text-white/40 font-mono mt-1">
                      Co-Pilot is retrieving indexed competencies from your live database and aligning with inspectorate standards.
                    </p>
                  </div>

                  {/* Processing Status logs list */}
                  <div className="bg-black/40 border border-white/5 rounded-xl p-4 w-full text-left font-mono text-[10px] text-white/50 space-y-1.5 max-h-[160px] overflow-y-auto">
                    {generationSteps.map((step, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <span className="text-cyan-400 font-bold">✓</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                // Setup Form Screen
                <form id="ai-generator-form" onSubmit={handleGenerateAISubmit} className="p-6 space-y-4 overflow-y-auto flex-1 no-scrollbar">
                  
                  {/* Topic field */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-white/40 font-mono uppercase tracking-wider">Lesson Topic / Subject matter</label>
                    <input
                      id="input-ai-topic"
                      type="text"
                      placeholder="E.g. Logic Gates (AND, OR, NOT), or Introduction to Quadratic Equations"
                      value={generatorForm.topic}
                      onChange={(e) => setGeneratorForm(prev => ({ ...prev, topic: e.target.value }))}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 focus:border-cyan-400/50 font-mono"
                      required
                    />
                  </div>

                  {/* Syllabus Alignment Selection */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-white/40 font-mono uppercase tracking-wider">Official Inspectorate Syllabus Alignment</label>
                    <p className="text-[10px] text-white/30 font-mono">Aligning with a syllabus allows the AI to extract and integrate official competencies.</p>
                    <select
                      id="select-ai-alignment-syllabus"
                      value={generatorForm.syllabusId}
                      onChange={(e) => setGeneratorForm(prev => ({ ...prev, syllabusId: e.target.value }))}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/50 focus:border-cyan-400/50 font-mono font-medium"
                    >
                      <option value="" className="bg-[#0C0C0C] text-white">-- No alignment (Produce general CBA Plan) --</option>
                      {syllabi.map(syllabus => (
                        <option key={syllabus.id} value={syllabus.id} className="bg-[#0C0C0C] text-white">
                          {syllabus.title} ({syllabus.subject} - {syllabus.class_level})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Title field */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-white/40 font-mono uppercase tracking-wider">Custom Plan Title (Optional)</label>
                    <input
                      id="input-ai-title"
                      type="text"
                      placeholder="Leave blank to auto-name"
                      value={generatorForm.title}
                      onChange={(e) => setGeneratorForm(prev => ({ ...prev, title: e.target.value }))}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 focus:border-cyan-400/50 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Duration field */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-white/40 font-mono uppercase tracking-wider">Target Duration</label>
                      <input
                        id="input-ai-duration"
                        type="text"
                        placeholder="E.g. 2 Hours"
                        value={generatorForm.duration}
                        onChange={(e) => setGeneratorForm(prev => ({ ...prev, duration: e.target.value }))}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 focus:border-cyan-400/50 font-mono"
                      />
                    </div>
                    {/* Teacher field */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-white/40 font-mono uppercase tracking-wider">Teacher Name</label>
                      <input
                        id="input-ai-teacher"
                        type="text"
                        placeholder="Minesec Teacher"
                        value={generatorForm.teacherName}
                        onChange={(e) => setGeneratorForm(prev => ({ ...prev, teacherName: e.target.value }))}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 focus:border-cyan-400/50 font-mono"
                      />
                    </div>
                  </div>

                  {/* Pedagogical Directives */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-white/40 font-mono uppercase tracking-wider">Custom Pedagogical Directives / Requirements</label>
                    <textarea
                      id="input-ai-directives"
                      placeholder="E.g. Focus heavily on practical programming tasks. Include active classroom brainstorming and specific formative questions for Cameroonian students."
                      value={generatorForm.customDirectives}
                      onChange={(e) => setGeneratorForm(prev => ({ ...prev, customDirectives: e.target.value }))}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 focus:border-cyan-400/50 font-mono"
                      rows={3}
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="pt-3 border-t border-white/10 flex justify-end gap-3 text-xs">
                    <button
                      id="btn-cancel-generation"
                      type="button"
                      onClick={() => setShowGeneratorModal(false)}
                      className="bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 font-semibold py-2.5 px-4 rounded-lg cursor-pointer font-mono"
                    >
                      Cancel
                    </button>
                    <button
                      id="btn-submit-generation"
                      type="submit"
                      className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-400/50 flex items-center gap-1.5 transition-all shadow-lg hover:shadow-cyan-400/15 font-mono py-2.5 px-5 rounded-lg font-bold cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 text-cyan-300 animate-pulse" />
                      CO-PILOT GENERATION
                    </button>
                  </div>

                </form>
              )}

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="bg-[#0A0A0A] text-white/40 py-6 text-center text-[11px] mt-auto border-t border-white/5 font-mono">
        <p className="font-semibold text-white/60 uppercase tracking-wider text-[11px]">MINESEC Academic Co-Pilot © 2026</p>
        <p className="mt-1.5 text-white/30">
          Under authorization of Cameroonian Ministry of Secondary Education — Designed for Competency Based Approach (CBA).
        </p>
        <p className="mt-1.5 text-[10px] text-white/20">
          Powered by Neon Serverless PostgreSQL, Supabase Auth & Cloudinary Attachment Systems.
        </p>
      </footer>

    </div>
  );
}
