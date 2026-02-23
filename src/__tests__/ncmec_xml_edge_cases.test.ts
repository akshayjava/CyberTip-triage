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

  it("extracts correct fields when attributes are present", () => {
    const xml = `<Report><TiplineNumber id="123">999</TiplineNumber></Report>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("999");
  });

  it("handles whitespace around values", () => {
    const xml = `<Report><TiplineNumber>  12345  </TiplineNumber></Report>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("12345");
  });

  it("handles mixed case tags", () => {
    const xml = `<Report><tiplinenumber>123</TIPLINENUMBER></Report>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBe("123");
  });

  it("handles nested structure correctly (ignoring unrelated nested tags)", () => {
    const xml = `
      <Report>
        <RelatedReport>
          <TiplineNumber>RELATED123</TiplineNumber>
        </RelatedReport>
        <!-- Main TiplineNumber missing -->
      </Report>
    `;
    const parsed = parseNcmecXml(xml);
    // Regex limitation: picks the first match. Ideally strict XML parsing would fail or return undefined.
    // Documenting current behavior:
    expect(parsed.ncmec_tip_number).toBe("RELATED123");
  });

  it("handles special characters in content", () => {
    const xml = `<Report><IncidentDescription>User said "Hello & Goodbye"</IncidentDescription></Report>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.section_a.incident_description).toBe('User said "Hello & Goodbye"');
  });

  it("handles self-closing tags", () => {
    const xml = `<Report><IsUrgent /></Report>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_urgent_flag).toBe(false);
  });

  it("handles empty tags", () => {
    const xml = `<Report><TiplineNumber></TiplineNumber></Report>`;
    const parsed = parseNcmecXml(xml);
    expect(parsed.ncmec_tip_number).toBeUndefined();
  });
});
