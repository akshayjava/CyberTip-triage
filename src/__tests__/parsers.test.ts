import { describe, it, expect } from "vitest";
import { parseNcmecPdfText, ncmecFilesToTipFiles } from "../parsers/ncmec_pdf.js";
import { parseNcmecXml } from "../parsers/ncmec_xml.js";
import { stripHtml, stripSignaturesAndBoilerplate, detectLanguage } from "../parsers/email_mime.js";

// ── NCMEC PDF Parser ──────────────────────────────────────────────────────────

const SAMPLE_PDF_TEXT = `
NCMEC CyberTipline Report
Report Number: 123456789
URGENT

Section A: Electronic Service Provider Information
Reporting ESP: Google
Incident Date: 2024-01-15
Subject Email: suspect@example.com
Subject Username: badactor99
Subject IP Address: 203.0.113.42

Uploaded File 1:
Filename: image001.jpg
File Size: 204800
File Viewed by Reporting ESP: Yes
Publicly Available: No
MD5: aabbccddaabbccddaabbccddaabbccdd
SHA1: aabbccddaabbccddaabbccddaabbccddaabbccdd
ESP Category: A1

Uploaded File 2:
Filename: video001.mp4
File Viewed by Reporting ESP: No
Publicly Available: No
SHA256: ${"cc".repeat(32)}

Description: User uploaded multiple files depicting minors in sexual acts.

Section B: Geolocation
Country: United States
State: California
City: Los Angeles
ISP: Comcast Cable

Section C: Additional Information
Related Tip: 987654321
Notes: Account has multiple prior reports.
`;

describe("NCMEC PDF Parser", () => {
  it("extracts tip number and urgent flag", () => {
    const parsed = parseNcmecPdfText(SAMPLE_PDF_TEXT);
    expect(parsed.ncmec_tip_number).toBe("123456789");
    expect(parsed.ncmec_urgent_flag).toBe(true);
  });

  it("extracts ESP name", () => {
    const parsed = parseNcmecPdfText(SAMPLE_PDF_TEXT);
    expect(parsed.section_a.esp_name).toMatch(/Google/i);
  });

  it("extracts subject identifiers", () => {
    const parsed = parseNcmecPdfText(SAMPLE_PDF_TEXT);
    expect(parsed.section_a.subject_email).toMatch(/suspect@example\.com/);
    expect(parsed.section_a.subject_username).toMatch(/badactor99/);
    expect(parsed.section_a.subject_ip).toMatch(/203\.0\.113\.42/);
  });

  it("extracts file 1 with esp_viewed=true", () => {
    const parsed = parseNcmecPdfText(SAMPLE_PDF_TEXT);
    const file1 = parsed.section_a.files[0];
    expect(file1).toBeDefined();
    expect(file1!.esp_viewed).toBe(true);
    expect(file1!.esp_viewed_missing).toBe(false);
    expect(file1!.publicly_available).toBe(false);
    expect(file1!.media_type).toBe("image");
  });

  it("extracts file 2 with esp_viewed=false", () => {
    const parsed = parseNcmecPdfText(SAMPLE_PDF_TEXT);
    const files = parsed.section_a.files;
    const file2 = files.find(f => f.filename?.includes("video"));
    expect(file2).toBeDefined();
    expect(file2!.esp_viewed).toBe(false);
    expect(file2!.media_type).toBe("video");
  });

  it("extracts section B geolocation", () => {
    const parsed = parseNcmecPdfText(SAMPLE_PDF_TEXT);
    expect(parsed.section_b.country).toMatch(/United States/i);
    expect(parsed.section_b.isp).toMatch(/Comcast/i);
  });

  it("extracts related tip from section C", () => {
    const parsed = parseNcmecPdfText(SAMPLE_PDF_TEXT);
    expect(parsed.section_c.related_tip_numbers).toContain("987654321");
  });

  it("ncmecFilesToTipFiles sets blocked=true for unviewed file", () => {
    const parsed = parseNcmecPdfText(SAMPLE_PDF_TEXT);
    const tipFiles = ncmecFilesToTipFiles(parsed.section_a.files);
    const unviewed = tipFiles.find(f => f.filename?.includes("video"));
    expect(unviewed?.file_access_blocked).toBe(true);
    expect(unviewed?.warrant_required).toBe(true);
  });

  it("ncmecFilesToTipFiles sets blocked=false for viewed file", () => {
    const parsed = parseNcmecPdfText(SAMPLE_PDF_TEXT);
    const tipFiles = ncmecFilesToTipFiles(parsed.section_a.files);
    const viewed = tipFiles.find(f => f.filename?.includes("image"));
    expect(viewed?.file_access_blocked).toBe(false);
    expect(viewed?.warrant_required).toBe(false);
  });
});

// ── NCMEC XML Parser ──────────────────────────────────────────────────────────

const SAMPLE_XML = `
<?xml version="1.0" encoding="UTF-8"?>
<CyberTiplineReport id="987654321">
  <TiplineNumber>987654321</TiplineNumber>
  <IsUrgent>false</IsUrgent>
  <ReportingEspName>Meta Platforms</ReportingEspName>
  <IncidentDescription>User shared inappropriate content involving minors.</IncidentDescription>
  <SubjectEmail>user@example.com</SubjectEmail>
  <SubjectIpAddress>198.51.100.22</SubjectIpAddress>
  <IncidentDateTime>2024-03-01T14:30:00Z</IncidentDateTime>
  <FileDetails>
    <FileName>photo.jpg</FileName>
    <ViewedByEsp>true</ViewedByEsp>
    <PubliclyAvailable>false</PubliclyAvailable>
    <MD5>aabbccdd11223344aabbccdd11223344</MD5>
    <EspCategory>A1</EspCategory>
  </FileDetails>
  <IpCountry>DE</IpCountry>
  <Isp>Deutsche Telekom</Isp>
  <RelatedReport>
    <TiplineNumber>111222333</TiplineNumber>
  </RelatedReport>
</CyberTiplineReport>
`;

describe("NCMEC XML Parser", () => {
  it("extracts tip number", () => {
    const parsed = parseNcmecXml(SAMPLE_XML);
    expect(parsed.ncmec_tip_number).toBe("987654321");
  });

  it("urgent flag is false", () => {
    const parsed = parseNcmecXml(SAMPLE_XML);
    expect(parsed.ncmec_urgent_flag).toBe(false);
  });

  it("extracts ESP name", () => {
    const parsed = parseNcmecXml(SAMPLE_XML);
    expect(parsed.reporter.esp_name).toMatch(/Meta/);
  });

  it("extracts file with esp_viewed=true", () => {
    const parsed = parseNcmecXml(SAMPLE_XML);
    const file = parsed.section_a.files[0];
    expect(file?.esp_viewed).toBe(true);
    expect(file?.esp_viewed_missing).toBe(false);
  });

  it("extracts related tip number", () => {
    const parsed = parseNcmecXml(SAMPLE_XML);
    expect(parsed.section_c.related_tip_numbers).toContain("111222333");
  });

  it("flags international jurisdiction from country code", () => {
    const parsed = parseNcmecXml(SAMPLE_XML);
    expect(parsed.section_b.country).toMatch(/DE/i);
  });
});

// ── Email Parser ──────────────────────────────────────────────────────────────

describe("Email MIME Parser", () => {
  it("strips HTML tags", () => {
    const html = "<p>Hello <strong>world</strong></p><br/>Test";
    const result = stripHtml(html);
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<strong>");
    expect(result).toContain("Hello");
    expect(result).toContain("world");
  });

  it("strips email signatures", () => {
    const text = "Important report content here.\n\n-- \nJohn Smith\nDetective, Cyber Unit";
    const result = stripSignaturesAndBoilerplate(text);
    expect(result).toContain("Important report content");
    expect(result).not.toContain("Detective, Cyber Unit");
  });

  it("strips reply chain", () => {
    const text = "New content.\n\nOn Mon, Jan 1 2024, admin@ncmec.org wrote:\n> Original message here";
    const result = stripSignaturesAndBoilerplate(text);
    expect(result).toContain("New content");
    expect(result).not.toContain("Original message here");
  });

  it("detects Cyrillic as Russian", () => {
    const cyrillic = "Привет мир это тест строка для определения языка";
    expect(detectLanguage(cyrillic)).toBe("ru");
  });

  it("detects Chinese characters", () => {
    const chinese = "这是一个测试字符串用于语言检测";
    expect(detectLanguage(chinese)).toBe("zh");
  });

  it("defaults to English for ASCII text", () => {
    const english = "This is a normal English text about suspicious activity";
    expect(detectLanguage(english)).toBe("en");
  });
});
