## รายงานทางเทคนิค: การวิเคราะห์คุณสมบัติ WeasyPrint (Python) เพื่อเป็นต้นแบบสำหรับการพัฒนา PDF Creator ด้วย TypeScript

**วัตถุประสงค์:** เพื่อสรุปสถาปัตยกรรม คุณสมบัติหลัก และการจัดการข้อความที่ซับซ้อน (โดยเฉพาะภาษาไทย) ของ WeasyPrint สำหรับใช้เป็น Baseline Requirement ในการสร้างไลบรารีสร้างไฟล์ PDF ด้วย TypeScript

---

### 1. สถาปัตยกรรมและกลไกการทำงานพื้นฐาน (Core Architecture)

WeasyPrint ทำงานโดยการแปลงเอกสารเว็บ (HTML/CSS) ให้เป็นเอกสารสำหรับพิมพ์ (PDF) โดยไม่ต้องพึ่งพาเบราว์เซอร์ (Headless Browser อย่าง Chrome/Puppeteer) ซึ่งทำให้มีน้ำหนักเบาและทำงานได้รวดเร็วกว่าในระดับไลบรารี

**ขั้นตอนการทำงาน (Rendering Pipeline):**

1. **HTML Parsing:** อ่านโครงสร้าง HTML และสร้าง Document Object Model (DOM)
2. **CSS Parsing:** ตีความ CSS stylesheet รวมถึงคุณสมบัติพิเศษสำหรับการพิมพ์
3. **Box Model & Layout:** คำนวณขนาด ตำแหน่ง และการจัดเรียงของอิลิเมนต์ต่างๆ ตามมาตรฐาน CSS
4. **Text Shaping & Line Breaking:** คำนวณการแสดงผลข้อความ ตัดคำ และจัดเรียงตัวอักษร
5. **PDF Generation:** วาดผลลัพธ์ลงบน Canvas และส่งออกเป็นไฟล์ PDF

---

### 2. คุณสมบัติหลักที่จำเป็น (Core Features Requirements)

หากต้องการพัฒนาเครื่องมือใน TypeScript ให้เทียบเท่า WeasyPrint จะต้องรองรับคุณสมบัติดังต่อไปนี้:

* **CSS Paged Media Module:** หัวใจสำคัญที่แยก Web Renderer ทั่วไปกับ PDF Renderer
* การจัดการขนาดกระดาษและระยะขอบ (`@page { size: A4; margin: 2cm; }`)
* การควบคุมการขึ้นหน้าใหม่ (`page-break-before`, `page-break-after`, `page-break-inside`)
* การสร้าง Header และ Footer อัตโนมัติที่ผูกกับเลขหน้า


* **Typography & Layout:**
* รองรับ Flexbox และ Grid Layout (บางส่วนที่จำเป็น)
* การจัดตำแหน่งข้อความ, Leading (Line-height), และ Kerning


* **Document Features:**
* การสร้างสารบัญ (Table of Contents) แบบโต้ตอบได้ (PDF Bookmarks/Outlines)
* การฝังลิงก์ (Internal & External Links)
* การรองรับรูปภาพแบบ Vector (SVG) และ Raster (PNG, JPEG) พร้อมจัดการ Color Profile



---

### 3. การแสดงผลภาษาไทยและภาษาที่ซับซ้อน (Complex Text Layout - CTL)

นี่คือจุดที่ท้าทายที่สุดในการสร้าง PDF Creator จากศูนย์ WeasyPrint ไม่ได้จัดการเรื่องนี้ด้วยตัวเองทั้งหมด แต่พึ่งพาระดับ OS/C-libraries ซึ่งเครื่องมือฝั่ง TypeScript จะต้องจำลองหรือหาไลบรารีทดแทน

**ความต้องการของเครื่องมือสำหรับการเรนเดอร์ภาษาไทย:**

* **Text Shaping (การจัดรูปแบบอักขระ):**
* ภาษาไทยมีสระลอยและวรรณยุกต์ซ้อน (เช่น "ผู้", "น้ำ", "พริก") เครื่องมือจะต้องรู้จักการทำงานร่วมกับ Font เพื่อจัดตำแหน่ง Glyph ให้ถูกต้อง (ไม่อย่างนั้นสระจะลอยหรือจมผิดตำแหน่ง)
* *WeasyPrint ใช้:* **HarfBuzz** ผ่าน Pango
* *สิ่งที่ TS ต้องการ:* ต้องมี Text Shaping Engine เช่น การใช้ WASM port ของ HarfBuzz (เช่น `harfbuzzjs`) หรือใช้ API ระดับล่าง


* **Line Breaking (การตัดคำ):**
* ภาษาไทยไม่ใช้ช่องว่างในการแยกคำ การขึ้นบรรทัดใหม่ต้องใช้พจนานุกรม (Dictionary-based) หรืออัลกอริทึมในการหาขอบเขตคำ
* *WeasyPrint ใช้:* **Pango** (ซึ่งอาจรวมกับ `libthai` ในระบบ Linux)
* *สิ่งที่ TS ต้องการ:* ต้องมีโมดูลตัดคำภาษาไทย เช่น การใช้ `Intl.Segmenter` (มาตรฐานใหม่ของ JS) หรือไลบรารีภายนอกเช่น `wordcut` ก่อนทำการคำนวณ Text wrap


* **Font Embedding & Fallback:**
* ต้องรองรับการฝังฟอนต์ TTF/OTF ลงในไฟล์ PDF โดยตรง (Subset embedding เพื่อลดขนาดไฟล์)
* ต้องมีระบบ Font Fallback กรณีที่ฟอนต์หลักไม่มี Glyph สำหรับตัวอักษรนั้นๆ (เช่น มีอักษรญี่ปุ่นปนอยู่ในข้อความภาษาไทย)
* *WeasyPrint ใช้:* **Fontconfig** ในการค้นหาและจัดการฟอนต์



---

### 4. สรุปความต้องการของระบบและเครื่องมือ (System & Tooling Requirements)

เพื่อให้เห็นภาพรวมของการสร้างโปรเจกต์ TypeScript นี่คือการเปรียบเทียบ Dependency ของ WeasyPrint กับ สิ่งที่คุณอาจจะต้องใช้ใน TypeScript:

| องค์ประกอบ | WeasyPrint (Python Ecosystem) | ตัวเลือกสำหรับ TypeScript Ecosystem |
| --- | --- | --- |
| **HTML/XML Parser** | `html5lib`, `tinycss2` | `parse5`, `cheerio`, `css-tree` |
| **Layout Engine** | WeasyPrint's internal engine | สร้างเอง หรือใช้เอนจินอย่าง `yoga-layout` |
| **Graphics / Canvas** | `Cairo` (C-library) | `PDFKit`, `pdf-lib`, หรือ `canvas` (Node-canvas) |
| **Text Shaping (CTL)** | `Pango` + `HarfBuzz` | `fontkit` (มีระบบ shaping เบื้องต้น), `harfbuzzjs` |
| **Word Segmentation** | `Pango` / OS Level (`libthai`) | `Intl.Segmenter`, ไลบรารี NLP ฝั่ง Node.js |

---

### ข้อเสนอแนะแนวทางสำหรับ TypeScript

การสร้าง Layout Engine และ Text Shaper ใหม่ทั้งหมดจากศูนย์เป็นงานที่ซับซ้อนมาก หากต้องการประสิทธิภาพแบบ WeasyPrint ใน TypeScript แนะนำให้พิจารณา 2 แนวทางนี้:

1. **Native Wrapper / WASM Approach:** สร้าง TypeScript wrapper เพื่อเรียกใช้ `HarfBuzz` (ผ่าน WebAssembly) สำหรับ Text Shaping และใช้ `PDFKit` สำหรับการวาดไฟล์ PDF โดยเขียนระบบ CSS Paged Media layout ครอบทับอีกชั้น


ต้องการให้เจาะลึกไปที่เทคนิคการทำ Text Shaping (จัดสระ/วรรณยุกต์) สำหรับภาษาไทยด้วย TypeScript หรือต้องการโฟกัสที่โครงสร้างการทำ Layout Engine ก่อนดีครับ?