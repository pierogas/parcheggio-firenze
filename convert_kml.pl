#!/usr/bin/perl
use strict;
use warnings;
use JSON::PP;

my $infile  = shift @ARGV or die "usage: convert_kml.pl input.kml output.js\n";
my $outfile = shift @ARGV or die "usage: convert_kml.pl input.kml output.js\n";

sub decode_entities {
    my ($s) = @_;
    return '' unless defined $s;
    $s =~ s/&#x([0-9a-fA-F]+);/chr(hex($1))/ge;
    $s =~ s/&#(\d+);/chr($1)/ge;
    $s =~ s/&lt;/</g;
    $s =~ s/&gt;/>/g;
    $s =~ s/&quot;/"/g;
    $s =~ s/&apos;/'/g;
    $s =~ s/&amp;/&/g;
    return $s;
}

sub round6 {
    my ($n) = @_;
    return $n + 0 unless $n =~ /\./;
    return sprintf("%.6f", $n) + 0;
}

open(my $fh, '<:raw', $infile) or die "cannot open $infile: $!";
local $/;
my $content = <$fh>;
close $fh;

my @placemarks = $content =~ /(<Placemark\b.*?<\/Placemark>)/gs;
print STDERR scalar(@placemarks), " placemarks found\n";

my @records;
my %street_index; # name -> 1

for my $pm (@placemarks) {
    my ($desc) = $pm =~ /<description>(.*?)<\/description>/s;
    next unless $desc;
    $desc = decode_entities($desc);

    my %f;
    while ($desc =~ /class="atr-name">([^<]+)<\/span>:<\/strong>\s*<span class="atr-value">([^<]*)<\/span>/g) {
        $f{$1} = $2;
    }
    next unless $f{indirizzo};

    # geometry: representative point
    my ($px, $py);
    if ($pm =~ /<Point>\s*<coordinates>([^<]*)<\/coordinates>\s*<\/Point>/s) {
        my $c = $1;
        $c =~ s/^\s+|\s+$//g;
        my ($lon, $lat) = split(/,/, $c);
        ($px, $py) = (round6($lon), round6($lat)) if defined $lon && defined $lat;
    }

    # all LineString coordinate arrays
    my @lines;
    while ($pm =~ /<LineString>\s*<coordinates>([^<]*)<\/coordinates>\s*<\/LineString>/gs) {
        my $coordtext = $1;
        $coordtext =~ s/^\s+|\s+$//g;
        my @pts;
        for my $pair (split(/\s+/, $coordtext)) {
            my ($lon, $lat) = split(/,/, $pair);
            next unless defined $lon && defined $lat;
            push @pts, [ round6($lon) + 0, round6($lat) + 0 ];
        }
        push @lines, \@pts if @pts;
    }

    my $rec = {
        via   => $f{indirizzo} // '',
        tr    => $f{tratto_strada} // '',
        day   => $f{giorno_settimana} // '',
        s     => $f{ora_inizio} // '',
        e     => $f{ora_fine} // '',
        w1    => ($f{prima_settimana}   // '0') + 0,
        w2    => ($f{seconda_settimana} // '0') + 0,
        w3    => ($f{terza_settimana}   // '0') + 0,
        w4    => ($f{quarta_settimana}  // '0') + 0,
        w5    => ($f{quinta_settimana}  // '0') + 0,
        pari  => ($f{pari}    // '0') + 0,
        dispari => ($f{dispari} // '0') + 0,
        nott  => ($f{notturno} // '0') + 0,
        wk    => ($f{settimanale} // '0') + 0,
        codvia => $f{codice_via} // '',
        pt    => (defined $px ? [$px, $py] : undef),
        ln    => (\@lines),
    };
    push @records, $rec;
    $street_index{$f{indirizzo}} = 1;
}

my @streets = sort keys %street_index;

my $json = JSON::PP->new->utf8(0)->canonical(1);
open(my $out, '>:encoding(UTF-8)', $outfile) or die "cannot write $outfile: $!";
print $out "// Generato automaticamente da pulizia_strade.kml (Comune di Firenze / Alia SpA)\n";
print $out "// Non modificare a mano: rigenerare con convert_kml.pl\n";
print $out "const SWEEPING_RECORDS = " . $json->encode(\@records) . ";\n";
print $out "const STREET_NAMES = " . $json->encode(\@streets) . ";\n";
close $out;

print STDERR "Wrote ", scalar(@records), " records and ", scalar(@streets), " distinct street names to $outfile\n";
