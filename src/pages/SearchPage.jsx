import React, { useState } from 'react';
import { TextField, Button, Box, Paper, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { initialPersonnel } from './ProfilePage'; // Assuming initialPersonnel is exported from ProfilePage

const SearchPage = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredPersonnel, setFilteredPersonnel] = useState([]);

  const handleSearch = () => {
    const results = initialPersonnel.filter(person =>
      person.rut.includes(searchTerm) ||
      person.nombres.toLowerCase().includes(searchTerm.toLowerCase()) ||
      person.empresa.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredPersonnel(results);
  };

  return (
    <Paper elevation={3} sx={{ p: 4, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Búsqueda de Personal
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <TextField
          label="Buscar por RUT, Nombre o Empresa"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          fullWidth
          margin="normal"
        />
        <Button variant="contained" color="primary" onClick={handleSearch} sx={{ ml: 2, mt: 1 }}>
          Buscar
        </Button>
      </Box>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>RUT</TableCell>
              <TableCell>Nombres</TableCell>
              <TableCell>Apellidos</TableCell>
              <TableCell>Teléfono</TableCell>
              <TableCell>Empresa</TableCell>
              <TableCell>Actividad</TableCell>
              <TableCell>Fecha de Inicio</TableCell>
              <TableCell>Fecha de Término</TableCell>
              <TableCell>Persona a Cargo</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredPersonnel.map((person, index) => (
              <TableRow key={index}>
                <TableCell>{person.rut}</TableCell>
                <TableCell>{person.nombres}</TableCell>
                <TableCell>{person.apellidos}</TableCell>
                <TableCell>{person.telefono}</TableCell>
                <TableCell>{person.empresa}</TableCell>
                <TableCell>{person.actividad}</TableCell>
                <TableCell>{person.fechaInicio}</TableCell>
                <TableCell>{person.fechaTermino}</TableCell>
                <TableCell>{person.personaACargo}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default SearchPage;
