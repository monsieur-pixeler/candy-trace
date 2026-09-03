export function generatePrompt(template: string, settings: { 
    pillName?: string;
    candyPhotoFilename?: string;
    styleRef1Filename?: string;
    styleRef2Filename?: string;
    logoText?: string;
 }): string {
  let result = template;
  if (settings.pillName) {
    result = result.replace(/{{pillName}}/g, settings.pillName);
  }
  if (settings.candyPhotoFilename) {
    result = result.replace(/{{candyPhotoFilename}}/g, settings.candyPhotoFilename);
  }
  if (settings.styleRef1Filename) {
    result = result.replace(/{{styleRef1Filename}}/g, settings.styleRef1Filename);
  }
  if (settings.styleRef2Filename) {
    result = result.replace(/{{styleRef2Filename}}/g, settings.styleRef2Filename);
  }
  if (settings.logoText) {
    result = result.replace(/{{logoText}}/g, settings.logoText);
  }
  return result;
}