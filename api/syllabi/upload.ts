import { IncomingForm } from "formidable";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import fs from "fs/promises";

import { cloudinary } from "../../src/lib/cloudinary";
import { pool } from "../../src/lib/db";
import { ai } from "../../src/lib/gemini";
import { Type } from "@google/genai";

import { extractTextFromFile } from "../../src/lib/fileExtractor";


export const config = {
  api: {
    bodyParser: false,
  },
};


export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }


  const form = new IncomingForm({
    maxFileSize: 15 * 1024 * 1024,
    keepExtensions: true,
  });


  try {

    const { files } = await new Promise<any>((resolve, reject) => {

      form.parse(req, (err, fields, files) => {

        if (err) reject(err);

        resolve({
          fields,
          files
        });

      });

    });


    const uploaded = files.file?.[0];

    if (!uploaded) {
      return res.status(400).json({
        error: "No file was uploaded."
      });
    }


    const filePath = uploaded.filepath;
    const fileName = uploaded.originalFilename || "syllabus";
    const fileType = uploaded.mimetype || "";
    const fileSize = uploaded.size;


    let cloudinaryResult:any = null;
    let rawText = "";


    // 1. Upload to Cloudinary

    if(process.env.CLOUDINARY_CLOUD_NAME){

      cloudinaryResult = await new Promise((resolve,reject)=>{

        cloudinary.uploader.upload(
          filePath,
          {
            resource_type:"raw",
            folder:"minesec_syllabi"
          },
          (error,result)=>{

            if(error) reject(error);
            else resolve(result);

          }
        );

      });

    }



    // 2. Extract syllabus text

    rawText = await extractTextFromFile(
      filePath,
      fileType
    );


    if(!rawText.trim()){

      throw new Error(
        "Could not extract readable text from file."
      );

    }



    // 3. Gemini indexing

    if(!ai){

      throw new Error(
        "Gemini API is not configured."
      );

    }



    const prompt = `
You are an expert AI syllabus indexer specializing in MINESEC Cameroon CBA.

Analyze this syllabus:

${rawText.substring(0,100000)}

Return JSON:

{
subject:"",
classLevel:"",
academicYear:"",
competencies":[],
learningOutcomes":[],
modules:[],
gradingStandards:[],
assessmentCriteria:[],
curriculumStructure:""
}
`;



    const response =
      await ai.models.generateContent({

        model:"gemini-3.5-flash",

        contents:prompt,

        config:{
          responseMimeType:"application/json",

          responseSchema:{
            type:Type.OBJECT,
            properties:{
              subject:{type:Type.STRING},
              classLevel:{type:Type.STRING},
              academicYear:{type:Type.STRING},
              competencies:{
                type:Type.ARRAY,
                items:{type:Type.STRING}
              },
              learningOutcomes:{
                type:Type.ARRAY,
                items:{type:Type.STRING}
              },
              modules:{
                type:Type.ARRAY,
                items:{
                  type:Type.OBJECT
                }
              },
              gradingStandards:{
                type:Type.ARRAY,
                items:{type:Type.STRING}
              },
              assessmentCriteria:{
                type:Type.ARRAY,
                items:{type:Type.STRING}
              },
              curriculumStructure:{
                type:Type.STRING
              }
            }
          }

        }

      });



    const metadata =
      JSON.parse(response.text || "{}");



    // 4. Save to Neon

    const result =
      await pool.query(
`
INSERT INTO syllabi
(
title,
subject,
class_level,
academic_year,
file_url,
file_name,
file_type,
file_size,
status,
extracted_metadata
)

VALUES
($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)

RETURNING *
`,
[
`${metadata.subject} Syllabus - ${metadata.classLevel}`,
metadata.subject,
metadata.classLevel,
metadata.academicYear || "2025/2026",
cloudinaryResult?.secure_url || "",
fileName,
fileType,
fileSize,
"published",
JSON.stringify(metadata)
]

);



return res.status(201).json(
result.rows[0]
);



  } catch(error:any){

    console.error(
      "Syllabus upload failed:",
      error
    );


    return res.status(500).json({
      error:error.message
    });


  }

}