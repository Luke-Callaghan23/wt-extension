
const childProcess = require('child_process');
const text = 'hello monkey';
const a = `&{
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
        synthesizer.Rate = 4;
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

let cp = childProcess.spawn(`powershell`, [ a ]);

cp.stderr.setEncoding('ascii');

const callback = (err) => {
    console.log(err);
} 

cp.stderr.once('data', (data) => {
    // we can't stop execution from this function
    callback(new Error(data))
})

cp.stdout.on('data', (data) => {
    const txt = data.toString();
    const json = JSON.parse(txt);
    console.log(json);
})

cp.addListener('exit', (code, signal) => {
    if (code === null || signal !== null) {
        return callback(new Error(`TTS could not talk, had an error [code: ${code}] [signal: ${signal}]`))
    }
    cp = null;
    callback(null);
})