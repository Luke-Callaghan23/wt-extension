
// Escapes text so it can sit inside a C# regular string literal
function escapeCSharp (text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
}

// Storing the powershell command in another file because it needs to be formatted weirdly to get processed correctly
// The command is passed to powershell base64 encoded, and the C# is in a single quoted here-string so that
// powershell never expands anything ($, backticks) inside the spoken text.
// Each word marker is written as one line of JSON.
// keep the C# in a literal here-string so powershell won't expand spoken text
// emit each word marker as one JSON line
export function getPowershellCommand (text: string, speed: number ): string { 
    const rate = Math.max(-10, Math.min(10, Math.round(speed)));
    return `&{
$code = @'
using System;
using System.Speech.Synthesis;
public class HelloWorld
{
    static int WordCount = 0;
    static string Esc(string s)
    {
        return (s ?? "").Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"").Replace("\\r", "\\\\r").Replace("\\n", "\\\\n").Replace("\\t", "\\\\t");
    }
    public static void Main()
    {
        var synthesizer = new SpeechSynthesizer();
        synthesizer.SpeakProgress += Synthesizer_SpeakProgress;
        synthesizer.Rate = ${rate};
        synthesizer.Speak("${escapeCSharp(text)}");
    }
    static void Synthesizer_SpeakProgress(object sender, SpeakProgressEventArgs e)
    {
        WordCount++;
        Console.WriteLine("{\\"wordCount\\": " + WordCount + ", \\"characterPosition\\": " + e.CharacterPosition + ", \\"characterCount\\": " + e.CharacterCount + ", \\"spokenText\\": \\"" + Esc(e.Text) + "\\"}");
    }
}
'@
Add-Type -TypeDefinition $code -Language CSharp -ReferencedAssemblies System.Speech;
[HelloWorld]::Main()
}
`;
}
