
document.getElementById('emailForm').addEventListener('submit', function () {
    // Extract HTML content from the Quill editor
    let htmlContent = quill.root.innerHTML;
    // Create a temporary element to parse the HTML content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;

    // Find all <img> tags inside the temporary div
    const imgElements = tempDiv.querySelectorAll('img');

    // Array to store image data for each image
    const imageDataArray = [];

    if(imgElements.length > 0)
    {
            
        // Counter to generate unique ContentID for each image
        let counter = 1;
        // Loop through each img element
        imgElements.forEach((imgElement) => {
            // Get the base64-encoded image data from the "src" attribute
            const base64ImageData = imgElement.getAttribute('src');

            // Get the image type (ContentType) and remove the prefix "data:image/png;base64,"
            const contentType = base64ImageData.split(';')[0].split(':')[1];
            const base64DataWithoutPrefix = base64ImageData.replace(/^data:image\/\w+;base64,/, '');

            // Generate a unique ContentID for each image
            const contentID = `id${counter}`;

            // Get the file name from the "alt" attribute (you can customize this based on your needs)
            const filename = imgElement.getAttribute('alt') || `image${counter}.${contentType.split('/')[1]}`;

            // Add image data to the array
            imageDataArray.push({
                ContentType: contentType,
                Filename: filename,
                ContentID: contentID,
                Base64Content: base64DataWithoutPrefix
            });
        // Increment counter
        counter++;
        });
                    // Convert the array to a JSON string
        // const imageDataArrayJSON = JSON.stringify(imageDataArray);

        // Use the modifyHtmlContent function to replace inline images with <img> tags
        let modifiedHtmlContent = htmlContent;

        imageDataArray.forEach((imageData, index) => {
            const placeholder = `cid:id${index + 1}`;
            const imgTag = `<img src=\\"${placeholder}\\">`;
            const base64DataToReplace = `<p><img src="data:${imageData.ContentType};base64,${imageData.Base64Content}"></p>`;
            modifiedHtmlContent = modifiedHtmlContent.split(base64DataToReplace).join(imgTag);
        });

        // Set the values of the hidden input fields
        document.getElementById('modifiedHtmlContent').value = modifiedHtmlContent;
        document.getElementById('imageDataArray').value = JSON.stringify(imageDataArray);
    }
    else
    {

        document.getElementById('modifiedHtmlContent').value = quill.root.innerHTML;
        document.getElementById('imageDataArray').value = [];
    }
});                
