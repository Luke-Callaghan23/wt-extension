export const wtToMd = (text: string) => {
    // Replace all "^" with "**"
    text = text.replaceAll("^", "**");

    // Replace all "~" with "~~"
    text = text.replaceAll("~", "~~");
    text = text.replaceAll("~~~~", "~~");

    return text;
}