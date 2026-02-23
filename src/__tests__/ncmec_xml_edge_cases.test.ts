import { describe, it, expect } from "vitest";
import { parseNcmecXml } from "../parsers/ncmec_xml.js";

describe("NCMEC XML Parser - Edge Cases", () => {
  it("extracts tip number from ReportId if TiplineNumber is missing", () => {
    const xml = `<CyberTiplineReport><ReportId>REPORT123</ReportId></CyberTiplineReport>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("REPORT123");
  });

  it("extracts tip number from Report id attribute as final fallback", () => {
    const xml = `<Report id="ATTR456"></Report>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("ATTR456");
  });

  it("handles different boolean representations for urgent flag", () => {
    expect(parseNcmecXml(`<IsUrgent>true</IsUrgent>`).ncmec_urgent_flag).toBe(true);
    expect(parseNcmecXml(`<IsUrgent>yes</IsUrgent>`).ncmec_urgent_flag).toBe(true);
    expect(parseNcmecXml(`<IsUrgent>1</IsUrgent>`).ncmec_urgent_flag).toBe(true);
    expect(parseNcmecXml(`<IsUrgent>TRUE</IsUrgent>`).ncmec_urgent_flag).toBe(true);
    expect(parseNcmecXml(`<IsUrgent>false</IsUrgent>`).ncmec_urgent_flag).toBe(false);
    expect(parseNcmecXml(`<IsUrgent>no</IsUrgent>`).ncmec_urgent_flag).toBe(false);
  });

  it("handles different boolean representations for file ViewedByEsp", () => {
    const xmlTrue = `<Report><FileDetails><ViewedByEsp>true</ViewedByEsp></FileDetails></Report>`;
    const xmlYes = `<Report><FileDetails><ViewedByEsp>yes</ViewedByEsp></FileDetails></Report>`;
    const xmlOne = `<Report><FileDetails><ViewedByEsp>1</ViewedByEsp></FileDetails></Report>`;
    const xmlFalse = `<Report><FileDetails><ViewedByEsp>false</ViewedByEsp></FileDetails></Report>`;

    expect(parseNcmecXml(xmlTrue).section_a.files[0].esp_viewed).toBe(true);
    expect(parseNcmecXml(xmlYes).section_a.files[0].esp_viewed).toBe(true);
    expect(parseNcmecXml(xmlOne).section_a.files[0].esp_viewed).toBe(true);
    expect(parseNcmecXml(xmlFalse).section_a.files[0].esp_viewed).toBe(false);
  });

  it("extracts files from all possible tags: FileDetails, File, Attachment", () => {
    const xml = `
      <Report>
        <FileDetails><FileName>file1.jpg</FileName></FileDetails>
        <File><FileName>file2.png</FileName></File>
        <Attachment><FileName>file3.pdf</FileName></Attachment>
      </Report>
    `;
    const parsed = parseNcmecXml(xml);
    expect(parsed.section_a.files).toHaveLength(3);
    const filenames = parsed.section_a.files.map(f => f.filename);
    expect(filenames).toContain("file1.jpg");
    expect(filenames).toContain("file2.png");
    expect(filenames).toContain("file3.pdf");
  });

  it("handles bundled reports", () => {
    const xml = `<Report><BundledReportCount>3</BundledReportCount></Report>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.is_bundled).toBe(true);
    expect(parsed.bundled_incident_count).toBe(3);
  });

  it("handles single reports in bundled field", () => {
    const xml = `<Report><IncidentCount>1</IncidentCount></Report>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.is_bundled).toBe(false);
    expect(parsed.bundled_incident_count).toBe(1);
  });

  it("slices country code to 2 characters and uppercases it", () => {
    const xml = `<Report><OriginCountry>usa</OriginCountry></Report>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.reporter.originating_country).toBe("US");
  });

  it("handles missing optional fields gracefully", () => {
    const xml = `<Report><TiplineNumber>123</TiplineNumber></Report>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("123");
    expect(parsed.section_a.subject_email).toBeUndefined();
    expect(parsed.section_a.files).toEqual([]);
  });

  it("handles malformed XML (missing closing tags) partially due to regex", () => {
    const xml = `<Report><TiplineNumber>123</TiplineNumber><IsUrgent>true`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("123");
    // Currently, xmlText expects a closing tag. So IsUrgent will be undefined.
    expect(parsed.ncmec_urgent_flag).toBe(false);
  });

  it("handles CDATA sections by stripping the wrapper but keeping content", () => {
    const xml = `<IncidentDescription><![CDATA[Some description with <tags> inside]]></IncidentDescription>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.section_a.incident_description).toBe("Some description with <tags> inside");
  });

  it("handles CDATA containing closing tag correctly", () => {
    const xml = `<IncidentDescription><![CDATA[ </IncidentDescription> ]]></IncidentDescription>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.section_a.incident_description).toBe("</IncidentDescription>");
  });

  it("strips XML comments from text content", () => {
    const xml = `<TiplineNumber><!-- comment -->999</TiplineNumber>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("999");
  });

  // ── Additional Edge Cases ───────────────────────────────────────────────────

  it("handles whitespace around values", () => {
    const xml = `<CyberTiplineReport><TiplineNumber>  12345  </TiplineNumber></CyberTiplineReport>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("12345");
  });

  it("handles mixed case tags (case insensitivity)", () => {
    const xml = `<CyberTiplineReport><tiplinenumber>67890</tiplinenumber></CyberTiplineReport>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("67890");
  });

  it("handles self-closing tags by ignoring them (regex limitation)", () => {
    // Current regex expects opening and closing tags, so self-closing tags are ignored
    const xml = `<CyberTiplineReport><TiplineNumber /></CyberTiplineReport>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBeUndefined();
  });

  it("handles empty tags by returning undefined", () => {
    const xml = `<CyberTiplineReport><TiplineNumber></TiplineNumber></CyberTiplineReport>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBeUndefined();
  });

  it("handles nested tags in content field", () => {
    // e.g. HTML in description
    const xml = `<IncidentDescription>This is <b>bold</b> text</IncidentDescription>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.section_a.incident_description).toBe("This is <b>bold</b> text");
  });

  it("handles nested tags with same name by matching first closing tag (regex behavior)", () => {
    // Regex is non-greedy so it will stop at first </IncidentDescription>
    const xml = `<IncidentDescription>Start <IncidentDescription>Inner</IncidentDescription> End</IncidentDescription>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.section_a.incident_description).toBe("Start <IncidentDescription>Inner");
  });

  it("handles multiple occurrences of same tag (first one wins for single fields)", () => {
    const xml = `<CyberTiplineReport>
      <TiplineNumber>111</TiplineNumber>
      <TiplineNumber>222</TiplineNumber>
    </CyberTiplineReport>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("111");
  });

  it("handles special characters in content", () => {
    const xml = `<IncidentDescription>1 &lt; 2 &amp; 3 &gt; 0</IncidentDescription>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.section_a.incident_description).toBe("1 &lt; 2 &amp; 3 &gt; 0");
  });

  it.skip("FAIL: handles attributes containing '>' inside quotes", () => {
    // KNOWN ISSUE: Regex `[^>]*` consumes until first `>`, breaking on attributes with `>`
    const xml = `<CyberTiplineReport><TiplineNumber id="12>3">999</TiplineNumber></CyberTiplineReport>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("999");
  });

  it.skip("FAIL: handles attributes with single quotes", () => {
    // KNOWN ISSUE: Regex hardcodes double quotes for attributes
    const xml = `<Report id='single'>Stuff</Report>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("single");
  });
});
