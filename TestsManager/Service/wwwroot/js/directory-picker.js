async function openDirectoryPicker() {
    const directoryHandle = await window.showDirectoryPicker();
    return directoryHandle.name;
};