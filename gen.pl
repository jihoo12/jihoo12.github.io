use strict;
use warnings;

# Open the file
open(my $fileHandle, '<', 'list.txt') or die "Failed to open the file: $!";

# Initialize a variable to store the result
my $result = '';

# Read the file line by line and process
while (my $line = <$fileHandle>) {
    chomp $line;  # Remove the newline character

    # Transform the value into <a href="value">value</a>
    my $transformedLine = qq{<a href="$line">$line</a>};

    # Append the transformed line to the result
    $result .= $transformedLine . "<br/>\n";
}

# Close the file
close($fileHandle);

# Print the transformed result
print $result;
