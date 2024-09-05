using Microsoft.JSInterop;

namespace Service.Utils
{
    public sealed class DirectoryPickerService
    {
        private readonly IJSRuntime _jsRuntime;

        public DirectoryPickerService(IJSRuntime jsRuntime)
        {
            _jsRuntime = jsRuntime;
        }

        public ValueTask<string> OpenDirectoryPickerAsync()
        {
            return _jsRuntime.InvokeAsync<string>("openDirectoryPicker");
        }
    }
}
