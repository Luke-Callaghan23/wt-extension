
// Storing the powershell command in another file because it needs to be formatted weirdly to get processed correctly
export function getPowershellCommand (text: string, speed: number ): string { 
    return `&{
$code = @"
using System;
using System.Speech.Synthesis;
public class HelloWorld
{
    static int WordCount = 0;
    public static void Main()
    {
        var synthesizer = new SpeechSynthesizer();
        synthesizer.SpeakProgress += Synthesizer_SpeakProgress;
        synthesizer.Rate = ${speed};
        // Speak the desired text
        synthesizer.Speak("${text}");
    }
    static void Synthesizer_SpeakProgress(object sender, SpeakProgressEventArgs e)
    {
        // Increment the word count for each word spoken
        WordCount++;
        // Print the word count and other details
        Console.WriteLine("{");
        Console.WriteLine("    \\"wordCount\\": " + WordCount + ",");
        Console.WriteLine("    \\"characterPosition\\": " + e.CharacterPosition + ",");
        Console.WriteLine("    \\"characterCount\\": " + e.CharacterCount + ", ");
        Console.WriteLine("    \\"spokenText\\": \\"" + e.Text + "\\"");
        Console.WriteLine("}");
    }
}
"@
# Compile and run the C# code
Add-Type -TypeDefinition $code -Language CSharp -ReferencedAssemblies System.Speech;
[HelloWorld]::Main()
}
`;
}