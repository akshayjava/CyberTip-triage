
import { parseNcmecXml } from "./src/parsers/ncmec_xml.js";
import { performance } from "perf_hooks";

function generateXml(fileCount: number): string {
  let files = "";
  for (let i = 0; i < fileCount; i++) {
    files += `
    <FileDetails>
      <FileName>file${i}.jpg</FileName>
      <FileSize>1024</FileSize>
      <EspViewed>true</EspViewed>
      <IsPublic>true</IsPublic>
      <MD5>d41d8cd98f00b204e9800998ecf8427e</MD5>
      <SHA1>da39a3ee5e6b4b0d3255bfef95601890afd80709</SHA1>
      <SHA256>e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</SHA256>
    </FileDetails>
    <!-- Some comment to trigger placeholder logic -->
    `;
  }

  return `
<Report id="12345678" urgent="true">
  <ReportId>12345678</ReportId>
  <Priority>1</Priority>
  <IncidentCount>1</IncidentCount>
  <ReportingEspName>Test ESP</ReportingEspName>
  <Country>US</Country>
  <IncidentDescription>
    <![CDATA[
      This is a sample incident description with some CDATA content.
      It helps verify that CDATA stripping works correctly.
    ]]>
  </IncidentDescription>
  <IncidentDateTime>2023-01-01T12:00:00Z</IncidentDateTime>
  <SubjectEmail>suspect@example.com</SubjectEmail>
  <SubjectUsername>suspect123</SubjectUsername>
  <SubjectIpAddress>192.168.1.1</SubjectIpAddress>
  <IpCountry>US</IpCountry>
  <IpCity>New York</IpCity>
  <IpState>NY</IpState>
  <Isp>Test ISP</Isp>
  <InvestigatorNotes>Some notes here.</InvestigatorNotes>
  ${files}
</Report>
`;
}

const smallXml = generateXml(5);
const mediumXml = generateXml(50);
const largeXml = generateXml(500);

function benchmark(label: string, xml: string, iterations: number) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    parseNcmecXml(xml);
  }
  const end = performance.now();
  console.log(`${label}: ${(end - start).toFixed(2)}ms for ${iterations} iterations (${((end - start) / iterations).toFixed(4)}ms per op)`);
}

console.log("Starting benchmarks...");
benchmark("Small XML (5 files)", smallXml, 1000);
benchmark("Medium XML (50 files)", mediumXml, 100);
benchmark("Large XML (500 files)", largeXml, 10);
